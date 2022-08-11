import {
	PersistentMap,
	storage,
	context,
	ContractPromiseBatch,
	u128,
} from 'near-sdk-as'

import {
	Event,
	_getEvent,
	_getEventHeight,
	pushEvent,
	EVENT_OWNERSHIP_TRANSFERRED,
	EVENT_TRANSFER,
	EVENT_TRANSFER_BATCH,
	EVENT_MARKET_UPDATE,
	EVENT_MARKET_DELETE,
	EVENT_MARKET_BUY,
	EVENT_BID_MARKET_ADD,
	EVENT_BID_MARKET_DELETE,
	EVENT_BID_MARKET_ACCEPT,
} from './event'

/**************************/
/* DATA TYPES AND STORAGE */
/**************************/

type AccountId = string
type TokenOwnerId = string
type TokenId = string

// The strings used to index variables in storage can be any string
// Let's set them to single characters to save storage space
const balances = new PersistentMap<TokenOwnerId, u128>('b2')
const creators = new PersistentMap<TokenId, AccountId>('c2')
const royalties = new PersistentMap<TokenId, u128>('r2')
const purchaseWhitelist = new PersistentMap<TokenId, u128>('w2')
const userPurchaseWhitelist = new PersistentMap<TokenOwnerId, u128>('wu2')
const purchaseLimits = new PersistentMap<TokenId, u128>('p2')
const lastPurchase = new PersistentMap<TokenOwnerId, u128>('lp2')

// Note that with this implementation, an account can only set one escrow at a
// time. You could make values an array of AccountIds if you need to, but this
// complicates the code and costs more in storage rent.
const escrowAccess = new PersistentMap<AccountId, AccountId>('e2')

@nearBindgen
class MarketData {
	quantity: u128
	price: u128

	constructor(quantity: u128, price: u128) {
		this.quantity = quantity
		this.price = price
	}
}
const market = new PersistentMap<TokenOwnerId, MarketData>('m2')
const bidMarket = new PersistentMap<TokenOwnerId, MarketData>('m3')

/******************/
/* ERROR MESSAGES */
/******************/

// These are exported for convenient unit testing
export const ERROR_NO_ESCROW_REGISTERED =
	'Paras: Caller has no escrow registered'
export const ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION =
	'Paras: Caller ID does not match expectation'
export const ERROR_OWNER_ID_DOES_NOT_MATCH_EXPECTATION =
	'Paras: Owner id does not match real token owner id'
export const ERROR_TOKEN_NOT_OWNED_BY_CALLER =
	'Paras: Token is not owned by the caller.'
export const ERROR_TOKEN_ALREADY_EXIST = 'Paras: Token ID already exist'

// CUSTOM EVENT FOR INDEXER
export function getEvent(index: i32): Event {
	return _getEvent(index)
}

export function getEventHeight(): i32 {
	return _getEventHeight()
}

// INIT
export function init(initialOwner: string): boolean {
	assert(storage.get<string>('init') == null, 'Paras: Already initialized')

	storage.set('owner', initialOwner)
	storage.set('init', true)

	return true
}

// OWNABLE
export const ERROR_ONLY_OWNER = 'Ownable: caller is not the owner'
export const ERROR_NEW_OWNER_EMPTY = 'Ownable: new owner is empty address'

export function owner(): string {
	const owner = storage.get<string>('owner')
	if (owner) {
		return owner
	}
	return ''
}

export function transferOwnership(newOwnerId: string): void {
	onlyOwner()

	assert(newOwnerId != '', ERROR_NEW_OWNER_EMPTY)

	pushEvent([EVENT_OWNERSHIP_TRANSFERRED, '', context.predecessor])
	storage.set('owner', newOwnerId)
}

export function renounceOwnership(): void {
	onlyOwner()

	pushEvent([EVENT_OWNERSHIP_TRANSFERRED, context.predecessor, ''])
	storage.set('owner', '')
}

function onlyOwner(): void {
	const owner = storage.get<string>('owner')
	const predecessor = context.predecessor

	assert(owner == predecessor, ERROR_ONLY_OWNER)
}

// TREASURY
export function setTreasury(accountId: string): void {
	onlyOwner()

	storage.set('treasury', accountId)
}

export function treasury(): string {
	const _treasury = storage.get<string>('treasury')
	if (_treasury) {
		return _treasury
	}
	return ''
}

/******************/
/* CHANGE METHODS */
/******************/

// Grant access to the given `accountId` for all tokens the caller has
export function grantAccess(escrowAccId: string): void {
	escrowAccess.set(context.predecessor, escrowAccId)
}

// Revoke access to the given `accountId` for all tokens the caller has
export function revokeAccess(): void {
	escrowAccess.delete(context.predecessor)
}

function _genTokenOwnerId(tokenId: string, ownerId: string): string {
	return tokenId + '::' + ownerId
}

// Transfer the given `token_id` to the given `new_owner_id`. Account `new_owner_id` becomes the new owner.
// Requirements:
// * The caller of the function (`predecessor`) should have access to the token.
export function transferFrom(
	ownerId: AccountId,
	newOwnerId: AccountId,
	tokenId: TokenId,
	quantity: u128
): TokenId {
	const predecessor = context.predecessor

	const escrow = escrowAccess.get(ownerId)
	assert(
		[ownerId, escrow].includes(predecessor),
		ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION
	)

	const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
	const newTokenOwnerId = _genTokenOwnerId(tokenId, newOwnerId)
	// const balance = tokenToOwner.getSome(tokenOwnerId)
	// assert(u128.gt(balance, u128.Zero), ERROR_OWNER_ID_DOES_NOT_MATCH_EXPECTATION)
	const fromBalance = balanceOf(ownerId, tokenId)
	const toBalance = balanceOf(newOwnerId, tokenId)
	const marketData_ = getMarketData(ownerId, tokenId)

	// check balance - market >= quantity
	if (marketData_) {
		assert(
			u128.gt(u128.sub(fromBalance, marketData_.quantity), quantity) ||
				u128.eq(u128.sub(fromBalance, marketData_.quantity), quantity),
			'Paras: Insufficient funds'
		)
	}
	assert(
		u128.gt(fromBalance, quantity) || u128.eq(fromBalance, quantity),
		'Paras: Insufficient funds'
	)

	// assign new owner to token
	balances.set(tokenOwnerId, u128.sub(fromBalance, quantity))
	balances.set(newTokenOwnerId, u128.add(toBalance, quantity))

	pushEvent([
		EVENT_TRANSFER,
		ownerId,
		newOwnerId,
		tokenId,
		quantity.toString(),
		context.blockTimestamp.toString(),
	])

	return tokenId
}

export function batchTransferFrom(
	ownerId: AccountId,
	newOwnerId: AccountId,
	tokenIds: TokenId[],
	quantities: u128[]
): void {
	assert(
		tokenIds.length == quantities.length,
		'Paras: tokenIds and values array length must match'
	)

	const predecessor = context.predecessor
	const escrow = escrowAccess.get(ownerId)
	assert(
		[ownerId, escrow].includes(predecessor),
		ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION
	)

	for (let i = 0; i < tokenIds.length; i++) {
		const tokenId = tokenIds[i]
		const value = quantities[i]

		const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
		const newTokenOwnerId = _genTokenOwnerId(tokenId, newOwnerId)
		// const balance = tokenToOwner.getSome(tokenOwnerId)
		// assert(u128.gt(balance, u128.Zero), ERROR_OWNER_ID_DOES_NOT_MATCH_EXPECTATION)
		const fromBalance = balanceOf(ownerId, tokenId)
		const toBalance = balanceOf(newOwnerId, tokenId)
		const marketData_ = getMarketData(ownerId, tokenId)

		// check balance - market >= quantity
		if (marketData_) {
			assert(
				u128.gt(u128.sub(fromBalance, marketData_.quantity), value) ||
					u128.eq(u128.sub(fromBalance, marketData_.quantity), value),
				'Paras: Insufficient funds'
			)
		}

		assert(
			u128.gt(fromBalance, value) || u128.eq(fromBalance, value),
			'Paras: Insufficient funds'
		)

		// assign new owner to token
		balances.set(tokenOwnerId, u128.sub(fromBalance, value))
		balances.set(newTokenOwnerId, u128.add(toBalance, value))
	}

	pushEvent([
		EVENT_TRANSFER_BATCH,
		ownerId,
		newOwnerId,
		tokenIds.join('::'),
		quantities.join('::'),
		context.blockTimestamp.toString(),
	])
}

export function burn(
	accountId: AccountId,
	tokenId: TokenId,
	quantity: u128
): TokenId {
	const predecessor = context.predecessor

	assert(accountId == predecessor, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)

	const balance_ = balanceOf(accountId, tokenId)
	assert(
		u128.gt(balance_, quantity) || u128.eq(balance_, quantity),
		'Paras: Insufficient funds'
	)
	transferFrom(accountId, '', tokenId, quantity)

	return tokenId
}

export function balanceOf(ownerId: string, tokenId: string): u128 {
	const key = _genTokenOwnerId(tokenId, ownerId)
	const bal = balances.get(key)
	if (bal) {
		return bal
	}
	return u128.Zero
}

export function balanceOfBatch(ownerIds: string[], tokenIds: string[]): u128[] {
	const balances_: u128[] = []

	for (let i = 0; i < ownerIds.length; i++) {
		const bal = balanceOf(ownerIds[i], tokenIds[i])
		balances_.push(bal)
	}

	return balances_
}

/****************/
/* VIEW METHODS */
/****************/

// Returns `true` or `false` based on caller of the function (`predecessor`) having access to account_id's tokens
export function checkAccess(accountId: AccountId): boolean {
	const caller = context.predecessor

	// throw error if someone tries to check if they have escrow access to their own account;
	// not part of the spec, but an edge case that deserves thoughtful handling
	assert(caller != accountId, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)

	// if we haven't set an escrow yet, then caller does not have access to account_id
	if (!escrowAccess.contains(accountId)) {
		return false
	}

	const escrow = escrowAccess.getSome(accountId)
	return escrow == caller
}

/********************/
/* NON-SPEC METHODS */
/********************/

export function getMarketData(
	ownerId: AccountId,
	tokenId: TokenId
): MarketData | null {
	const key = _genTokenOwnerId(tokenId, ownerId)
	return market.get(key)
}

export function updateMarketData(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128,
	amount: u128
): void {
	const predecessor = context.predecessor

	assert(ownerId == predecessor, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)

	const balance_ = balanceOf(ownerId, tokenId)
	assert(
		u128.gt(balance_, quantity) || u128.eq(balance_, quantity),
		'Paras: Insufficient funds'
	)

	// check if whitelist is needed
	const hasWhitelist = purchaseWhitelist.get(tokenId)

	// if token needs whitelist
	if (hasWhitelist == u128.One) {
		const creator = creators.get(tokenId)
		assert(creator == predecessor, 'Paras: Only creator can sell this NFT')
	}

	_updateMarketData(ownerId, tokenId, quantity, amount)
}

export function deleteMarketData(ownerId: AccountId, tokenId: TokenId): void {
	const predecessor = context.predecessor

	assert(ownerId == predecessor, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)

	_deleteMarketData(ownerId, tokenId)
}

export function buy(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128
): void {
	const buyerId = context.predecessor

	const marketData_ = getMarketData(ownerId, tokenId)
	assert(!!marketData_, 'Paras: Token is not on sale')

	assert(u128.gt(quantity, u128.Zero), 'Paras: Quantity must be more than 0')

	assert(buyerId != ownerId, 'Paras: BuyerId and OwnerId must be different')

	// check if whitelist is needed
	const hasWhitelist = purchaseWhitelist.get(tokenId)

	// if token needs whitelist
	if (hasWhitelist == u128.One) {
		// check if buyer is whitelisted
		const tokenBuyerId = _genTokenOwnerId(tokenId, buyerId)
		const isBuyerWhitelisted = userPurchaseWhitelist.get(tokenBuyerId)
		assert(isBuyerWhitelisted == u128.One, 'Paras: Buyer is not whitelisted')

		const lastPurchaseTime = lastPurchase.get(
			_genTokenOwnerId(tokenId, buyerId)
		)

		if (lastPurchaseTime) {
			assert(
				u128.gt(
					u128.sub(u128.from(context.blockTimestamp), u128.from(30000000000)),
					lastPurchaseTime
				),
				'Paras: Please wait few seconds before purchasing another one'
			)
		}
	}

	// check if has purchase limit
	const hasPurchaseLimit = purchaseLimits.get(tokenId)

	if (hasPurchaseLimit) {
		assert(
			u128.lt(quantity, u128.add(hasPurchaseLimit, u128.One)),
			'Paras: Quantity exceed purchase limit'
		)
	}

	if (marketData_) {
		assert(
			u128.gt(marketData_.quantity, quantity) ||
				u128.eq(marketData_.quantity, quantity),
			'Paras: Quantity more than token available'
		)

		const amount = context.attachedDeposit
		const totalPrice = u128.mul(marketData_.price, quantity)
		assert(
			totalPrice == amount,
			'Paras: Attached deposit not match with token price'
		)
		_buy(ownerId, buyerId, tokenId, quantity, amount)

		// update the market data
		const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
		const key = tokenOwnerId
		const newMarketData = new MarketData(
			u128.sub(marketData_.quantity, quantity),
			marketData_.price
		)
		market.set(key, newMarketData)
		lastPurchase.set(buyerId, u128.from(context.blockTimestamp))

		pushEvent([
			EVENT_MARKET_BUY,
			ownerId,
			buyerId,
			tokenId,
			quantity.toString(),
			marketData_.price.toString(),
			context.blockTimestamp.toString(),
		])

	}
}

function _buy(
	ownerId: AccountId,
	buyerId: AccountId,
	tokenId: TokenId,
	quantity: u128,
	amount: u128 //total amount == quantity*one_card_price
): void {
	const fromBalance = balanceOf(ownerId, tokenId)
	const toBalance = balanceOf(buyerId, tokenId)

	// double check the user balance
	assert(
		u128.gt(fromBalance, quantity) || u128.eq(fromBalance, quantity),
		'Paras: Seller balance must be more than buy quantity'
	)

	// transfer amount
	let _ownerShare: u128 = u128.from(95)
	let _artistShare: u128 = u128.Zero

	const _royalty: u128 | null = royalties.get(tokenId)
	if (_royalty && u128.gt(_royalty, u128.Zero)) {
		_ownerShare = u128.sub(u128.from(95), _royalty)
		_artistShare = _royalty
	}

	const forOwner: u128 = u128.div(
		u128.mul(amount, u128.from(_ownerShare)),
		u128.from(100)
	)
	const forArtist: u128 = u128.div(
		u128.mul(amount, u128.from(_artistShare)),
		u128.from(100)
	)
	const forTreasury: u128 = u128.sub(amount, u128.add(forOwner, forArtist))

	const _treasury = treasury()
	const _owner = owner()
	const treasuryAccount = _treasury.length > 0 ? _treasury : _owner

	ContractPromiseBatch.create(ownerId).transfer(forOwner)
	if (u128.gt(forArtist, u128.Zero)) {
		const artistId = creators.getSome(tokenId)
		ContractPromiseBatch.create(artistId).transfer(forArtist)
	}
	ContractPromiseBatch.create(treasuryAccount).transfer(forTreasury)

	// assign token to new owner
	const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
	const newTokenOwnerId = _genTokenOwnerId(tokenId, buyerId)

	balances.set(tokenOwnerId, u128.sub(fromBalance, quantity))
	balances.set(newTokenOwnerId, u128.add(toBalance, quantity))

	
}

export function mintTo(
	ownerId: AccountId,
	tokenId: TokenId,
	supply: u128
): TokenId {
	onlyOwner()

	_mintTo(ownerId, tokenId, supply)

	return tokenId
}

export function mintToAndSell(
	ownerId: AccountId,
	tokenId: TokenId,
	supply: u128,
	quantity: u128,
	amount: u128
): TokenId {
	onlyOwner()

	_mintTo(ownerId, tokenId, supply)
	_updateMarketData(ownerId, tokenId, quantity, amount)

	return tokenId
}

export function mintToWithRoyalty(
	ownerId: AccountId,
	tokenId: TokenId,
	supply: u128,
	royalty: u128
): TokenId {
	onlyOwner()

	assert(
		(u128.eq(royalty, u128.Zero) || u128.gt(royalty, u128.Zero)) &&
			u128.lt(royalty, u128.from(91)),
		'Paras: Royalty must be >= 0 and <= 90'
	)

	_mintToWithRoyalty(ownerId, tokenId, supply, royalty)

	return tokenId
}

export function mintToAndSellWithRoyalty(
	ownerId: AccountId,
	tokenId: TokenId,
	supply: u128,
	quantity: u128,
	amount: u128,
	royalty: u128
): TokenId {
	mintToWithRoyalty(ownerId, tokenId, supply, royalty)
	_updateMarketData(ownerId, tokenId, quantity, amount)

	return tokenId
}

export function updateTokenPurchaseWhitelist(
	tokenId: TokenId,
	value: boolean
): TokenId {
	onlyOwner()

	if (value) {
		purchaseWhitelist.set(tokenId, u128.One)
	} else {
		purchaseWhitelist.set(tokenId, u128.Zero)
	}

	return tokenId
}

export function updateTokenPurchaseLimits(
	tokenId: TokenId,
	amount: u128
): TokenId {
	onlyOwner()

	purchaseLimits.set(tokenId, amount)

	return tokenId
}

export function addUserPurchaseWhitelist(
	tokenId: TokenId,
	buyerId: AccountId
): TokenId {
	onlyOwner()

	const hasWhitelist = purchaseWhitelist.getSome(tokenId)

	if (hasWhitelist) {
		const tokenBuyerId = _genTokenOwnerId(tokenId, buyerId)
		userPurchaseWhitelist.set(tokenBuyerId, u128.One)
		return tokenBuyerId
	}

	return tokenId
}

export function addUserPurchaseWhitelistBulk(
	tokenId: TokenId,
	buyerIds: AccountId[]
): TokenId {
	onlyOwner()

	const hasWhitelist = purchaseWhitelist.getSome(tokenId)

	if (hasWhitelist) {
		for (let i = 0; i < buyerIds.length; i++) {
			const buyerId = buyerIds[i]
			const tokenBuyerId = _genTokenOwnerId(tokenId, buyerId)
			userPurchaseWhitelist.set(tokenBuyerId, u128.One)
		}
		return tokenId
	}

	return tokenId
}

export function getUserPurchaseWhitelist(
	tokenId: TokenId,
	buyerId: AccountId
): string {
	const hasWhitelist = purchaseWhitelist.get(tokenId)

	if (hasWhitelist == u128.One) {
		const tokenBuyerId = _genTokenOwnerId(tokenId, buyerId)
		const userWhitelisted = userPurchaseWhitelist.get(tokenBuyerId)
		if (userWhitelisted) {
			return 'token_whitelisted::user_whitelisted'
		}

		return 'token_whitelisted::user_not_whitelisted'
	}

	return 'token_not_whitelisted::user_whitelisted'
}

export function removeUserPurchaseWhitelist(
	tokenId: TokenId,
	buyerId: AccountId
): TokenId {
	onlyOwner()

	const tokenBuyerId = _genTokenOwnerId(tokenId, buyerId)
	const userWhitelisted = userPurchaseWhitelist.getSome(tokenBuyerId)
	if (userWhitelisted) {
		userPurchaseWhitelist.delete(tokenBuyerId)
		return tokenBuyerId
	}

	return tokenId
}

function _mintTo(ownerId: AccountId, tokenId: TokenId, supply: u128): TokenId {
	// make sure the tokenId does not exist
	const tokenExist = creators.get(tokenId)
	assert(!tokenExist, ERROR_TOKEN_ALREADY_EXIST)

	const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
	balances.set(tokenOwnerId, supply)
	creators.set(tokenId, ownerId)

	pushEvent([
		EVENT_TRANSFER,
		'',
		ownerId,
		tokenId,
		supply.toString(),
		context.blockTimestamp.toString(),
	])

	return tokenId
}

function _mintToWithRoyalty(
	ownerId: AccountId,
	tokenId: TokenId,
	supply: u128,
	royalty: u128
): TokenId {
	// make sure the tokenId does not exist
	const tokenExist = creators.get(tokenId)
	assert(!tokenExist, ERROR_TOKEN_ALREADY_EXIST)

	const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
	balances.set(tokenOwnerId, supply)
	creators.set(tokenId, ownerId)
	royalties.set(tokenId, royalty)

	pushEvent([
		EVENT_TRANSFER,
		'',
		ownerId,
		tokenId,
		supply.toString(),
		context.blockTimestamp.toString(),
	])

	return tokenId
}

function _updateMarketData(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128,
	amount: u128
): void {
	const key = _genTokenOwnerId(tokenId, ownerId)

	const newMarketData = new MarketData(quantity, amount)
	market.set(key, newMarketData)

	pushEvent([
		EVENT_MARKET_UPDATE,
		ownerId,
		tokenId,
		quantity.toString(),
		amount.toString(),
		context.blockTimestamp.toString(),
	])
}

function _deleteMarketData(ownerId: AccountId, tokenId: TokenId): void {
	const key = _genTokenOwnerId(tokenId, ownerId)
	market.delete(key)

	pushEvent([
		EVENT_MARKET_DELETE,
		ownerId,
		tokenId,
		context.blockTimestamp.toString(),
	])
}

export function acceptBidMarketData(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128
): void {
	const keyBuyer = _genTokenOwnerId(tokenId, ownerId)
	const marketDataBuyer = bidMarket.getSome(keyBuyer)

	assert(
		u128.gt(marketDataBuyer.quantity, quantity) ||
			u128.eq(marketDataBuyer.quantity, quantity),
		'Paras: Quantity more than token offered'
	)


	const totalPrice = u128.mul(marketDataBuyer.price, quantity)

	const sellerId = context.predecessor
	const keySeller = _genTokenOwnerId(tokenId, sellerId)

	assert(sellerId != ownerId, 'Paras: SellerId and OwnerId must be different')

	if (market.contains(keySeller)) {
		let marketDataSeller = market.getSome(keySeller)
		let activeBalance = u128.sub(balanceOf(sellerId, tokenId), marketDataSeller.quantity)
		assert(
			u128.gt(activeBalance, quantity) || u128.eq(activeBalance, quantity),
			"Paras: Token quantity not sufficient"
		)
	}

	_buy(sellerId, ownerId, tokenId, quantity, totalPrice)

	// update the bid market data
	const tokenOwnerId = _genTokenOwnerId(tokenId, ownerId)
	const key = tokenOwnerId
	const newMarketData = new MarketData(
		u128.sub(marketDataBuyer.quantity, quantity),
		marketDataBuyer.price
	)
    if (newMarketData.quantity <= u128.from(0)) {
		bidMarket.delete(key)
	}
	else {
		bidMarket.set(key, newMarketData)
	}

	pushEvent([
		EVENT_BID_MARKET_ACCEPT,
		ownerId,
		sellerId,
		tokenId,
		quantity.toString(),
		marketDataBuyer.price.toString(),
		context.blockTimestamp.toString(),
	])

}

export function getBidMarketData(
	ownerId: AccountId,
	tokenId: TokenId
): MarketData | null {
	const key = _genTokenOwnerId(tokenId, ownerId)
	return bidMarket.get(key)
}

export function addBidMarketData(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128,
	amount: u128
): void {
	const predecessor = context.predecessor

	assert(ownerId == predecessor, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)

	const depositAmount: u128 = u128.sub(context.attachedDeposit, u128.from("3000000000000000000000"))

	const totalPrice: u128 = u128.mul(amount, quantity)
	assert(
		u128.gt(depositAmount, totalPrice) || u128.eq(depositAmount, totalPrice),
		'Paras: Attached deposit not match with token price. Attach 0.003 NEAR as fee.'
	)

	_addBidMarketData(ownerId, tokenId, quantity, amount)
}

export function deleteBidMarketData(ownerId: AccountId, tokenId: TokenId): void {
	const predecessor = context.predecessor

	assert(ownerId == predecessor, ERROR_CALLER_ID_DOES_NOT_MATCH_EXPECTATION)
	_deleteBidMarketData(ownerId, tokenId)
}

function _addBidMarketData(
	ownerId: AccountId,
	tokenId: TokenId,
	quantity: u128,
	amount: u128
): void {
	const key = _genTokenOwnerId(tokenId, ownerId)
	const newMarketData = new MarketData(quantity, amount)
	assert(
		bidMarket.contains(key) == false,
		'Paras: Must cancel bid before add another bid.'
	)

	bidMarket.set(key, newMarketData)

	pushEvent([
		EVENT_BID_MARKET_ADD,
		ownerId,
		tokenId,
		quantity.toString(),
		amount.toString(),
		context.blockTimestamp.toString(),
	])
}

function _deleteBidMarketData(ownerId: AccountId, tokenId: TokenId): void {
	const key = _genTokenOwnerId(tokenId, ownerId)
	const bidMarketData = bidMarket.getSome(key)
	const totalPrice = u128.mul(bidMarketData.price, bidMarketData.quantity)
	ContractPromiseBatch.create(ownerId).transfer(totalPrice)
	bidMarket.delete(key)

	pushEvent([
		EVENT_BID_MARKET_DELETE,
		ownerId,
		tokenId,
		context.blockTimestamp.toString(),
	])
}