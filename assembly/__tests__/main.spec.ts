import { u128, VMContext } from 'near-sdk-as'

import {
	init,
	owner,
	transferOwnership,
	renounceOwnership,
	mintTo,
	balanceOf,
	ERROR_ONLY_OWNER,
	transferFrom,
	grantAccess,
	updateMarketData,
	getMarketData,
	deleteMarketData,
	buy,
	mintToAndSell,
	treasury,
	setTreasury,
	burn,
	mintToAndSellWithRoyalty,
	mintToWithRoyalty,
	updateTokenPurchaseWhitelist,
	updateTokenPurchaseLimits,
	addUserPurchaseWhitelist,
	getBidMarketData,
	addBidMarketData,
	deleteBidMarketData,
	acceptBidMarketData
} from '../main'

const alice = 'Alice'
const bob = 'Bob'
const carol = 'Carol'
const cTreasury = 'Treasury'
const bidFee = "3000000000000000000000"

describe('Contract', () => {
	beforeEach(() => {
		VMContext.setPredecessor_account_id(alice)
		init(alice)
	})

	it('Should has contract owner', () => {
		const contractOwner = owner()
		expect(contractOwner).toBe(alice)
	})

	it('Should transfer contract owner to other account', () => {
		transferOwnership(bob)
		const contractOwner = owner()
		expect(contractOwner).toBe(bob)
	})

	it('Should transfer contract owner to empty account', () => {
		renounceOwnership()
		const contractOwner = owner()
		expect(contractOwner).toBe('')
	})

	it('Should set contract treasury', () => {
		setTreasury(cTreasury)
		const contractTreasury = treasury()
		expect(contractTreasury).toBe(cTreasury)
	})

	it('Should mint new token only by owner', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(1)
		mintTo(bob, tokenId, quantity)

		const bal_ = balanceOf(bob, tokenId)
		expect(bal_).toBe(quantity)
	})

	it('Should not mint new token from public', () => {
		expect(() => {
			VMContext.setPredecessor_account_id(bob)
			const tokenId = '1'
			const quantity = u128.from(1)
			mintTo(bob, tokenId, quantity)
		}).toThrow(ERROR_ONLY_OWNER)
	})

	it('Should burn token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)
		burn(bob, tokenId, u128.from(5))

		const bobBal_ = balanceOf(bob, tokenId)
		expect(bobBal_).toBe(u128.from(5))
	})

	it('Should not burn token more than owned and throw error', () => {
		expect(() => {
			VMContext.setPredecessor_account_id(alice)
			const tokenId = '1'
			const quantity = u128.from(10)
			mintTo(bob, tokenId, quantity)

			VMContext.setPredecessor_account_id(bob)
			burn(bob, tokenId, u128.from(20))
		}).toThrow()
	})

	it('Should not burn token on the marketplace and throw error', () => {
		expect(() => {
			VMContext.setPredecessor_account_id(alice)
			const tokenId = '1'
			const quantity = u128.from(10)
			mintToAndSell(bob, tokenId, quantity, quantity, u128.One)

			VMContext.setPredecessor_account_id(bob)
			burn(bob, tokenId, u128.from(10))
		}).toThrow()
	})

	it('Should transferFrom token from owner to other account', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)
		transferFrom(bob, carol, tokenId, u128.from(5))

		const bobBal_ = balanceOf(bob, tokenId)
		const carolBal_ = balanceOf(carol, tokenId)
		expect(bobBal_).toBe(u128.from(5))
		expect(carolBal_).toBe(u128.from(5))
	})

	it('Should transferFrom token via escrow to other account', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)
		grantAccess(alice)

		VMContext.setPredecessor_account_id(alice)
		transferFrom(bob, carol, tokenId, u128.from(5))

		const bobBal_ = balanceOf(bob, tokenId)
		const carolBal_ = balanceOf(carol, tokenId)
		expect(bobBal_).toBe(u128.from(5))
		expect(carolBal_).toBe(u128.from(5))
	})

	it('Should updateMarketData for token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)
		grantAccess(alice)

		const setPrice = '10000000000000000000000000'
		updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

		const marketData_ = getMarketData(bob, tokenId)
		if (marketData_) {
			expect(marketData_.quantity).toBe(quantity)
			expect(marketData_.price).toBe(u128.from(setPrice))
		}
	})

	it('Should removeMarketPrice for token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)

		const setPrice = '10000000000000000000000000'
		updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

		deleteMarketData(bob, tokenId)
		const marketData_ = getMarketData(bob, tokenId)
		expect(marketData_).toBe(null)
	})

	it('Should calculate commission as expected', () => {
		const amount = '1000000000000000000000000000'

		const t1 = u128.div(
			u128.mul(u128.from(amount), u128.from(95)),
			u128.from(100)
		)
		const _t1_1 = u128.mul(u128.from(amount), u128.from(95))
		const _t1_2 = u128.div10(_t1_1)
		const _t1 = u128.div10(_t1_2)
		expect(t1).toBe(_t1)
	})

	it('Should buy token from marketplace', () => {
		VMContext.setStorage_usage(100)

		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)

		const setPrice = '10000000000000000000000000'
		// only list 9 token, reserve 1 for creator
		updateMarketData(
			bob,
			tokenId,
			u128.sub(quantity, u128.One),
			u128.from(setPrice)
		)

		VMContext.setPredecessor_account_id(carol)
		VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(3)))
		buy(bob, tokenId, u128.from(3))

		const bobBal_ = balanceOf(bob, tokenId)
		const carolBal_ = balanceOf(carol, tokenId)
		expect(bobBal_).toBe(u128.from(7))
		expect(carolBal_).toBe(u128.from(3))

		const updatedMarketData = getMarketData(bob, tokenId)
		if (updatedMarketData) {
			expect(updatedMarketData.quantity).toBe(u128.from(6))
			expect(updatedMarketData.price).toBe(u128.from(setPrice))
		}
	})

	it('Should only buy token from marketplace for different buyer and seller', () => {
		expect(() => {
			VMContext.setStorage_usage(100)

			VMContext.setPredecessor_account_id(alice)
			const tokenId = '1'
			const quantity = u128.from(10)
			mintTo(bob, tokenId, quantity)

			VMContext.setPredecessor_account_id(bob)

			const setPrice = '10000000000000000000000000'
			updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

			VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(3)))
			buy(bob, tokenId, u128.from(3))
		}).toThrow()
	})

	it('Should only buy token from marketplace for quantity > 0', () => {
		expect(() => {
			VMContext.setStorage_usage(100)

			VMContext.setPredecessor_account_id(alice)
			const tokenId = '1'
			const quantity = u128.from(10)
			mintTo(bob, tokenId, quantity)

			VMContext.setPredecessor_account_id(bob)

			const setPrice = '10000000000000000000000000'
			updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

			VMContext.setPredecessor_account_id(carol)
			VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(3)))
			buy(bob, tokenId, u128.from(0))
		}).toThrow()
	})

	it('Should mintToAndSell new token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const supply = u128.from(10)
		const quantity = u128.from(9)

		const setPrice = '10000000000000000000000000'

		mintToAndSell(bob, tokenId, supply, quantity, u128.from(setPrice))
		const bobBal_ = balanceOf(bob, tokenId)
		expect(bobBal_).toBe(supply)

		const marketData_ = getMarketData(bob, tokenId)
		if (marketData_) {
			expect(marketData_.quantity).toBe(quantity)
			expect(marketData_.price).toBe(u128.from(setPrice))
		}
	})

	it('Should buy token from marketplace with royalty', () => {
		VMContext.setStorage_usage(100)

		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		const royalty = u128.from(32)
		mintToWithRoyalty(bob, tokenId, quantity, royalty)

		// send 1 to friend and list it on market
		VMContext.setPredecessor_account_id(bob)
		transferFrom(bob, alice, tokenId, u128.One)

		VMContext.setPredecessor_account_id(alice)
		const setPrice = '10000000000000000000000000'
		updateMarketData(alice, tokenId, u128.from(1), u128.from(setPrice))

		VMContext.setPredecessor_account_id(carol)
		VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(1)))
		buy(alice, tokenId, u128.from(1))
	})

	it('Should only allow whitelisted users to purchase token', () => {
		VMContext.setStorage_usage(100)

		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(bob)

		const setPrice = '10000000000000000000000000'
		updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

		VMContext.setPredecessor_account_id(alice)
		updateTokenPurchaseWhitelist(tokenId, true)
		addUserPurchaseWhitelist(tokenId, carol)

		VMContext.setPredecessor_account_id(carol)
		VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(3)))
		buy(bob, tokenId, u128.from(3))
	})

	it('Should only allow limited quantity in a single purchase', () => {
		expect(() => {
			VMContext.setStorage_usage(100)

			VMContext.setPredecessor_account_id(alice)
			const tokenId = '1'
			const quantity = u128.from(10)
			mintTo(bob, tokenId, quantity)

			VMContext.setPredecessor_account_id(bob)

			const setPrice = '10000000000000000000000000'
			updateMarketData(bob, tokenId, quantity, u128.from(setPrice))

			VMContext.setPredecessor_account_id(alice)
			updateTokenPurchaseLimits(tokenId, u128.from(3))

			VMContext.setPredecessor_account_id(carol)
			VMContext.setAttached_deposit(u128.mul(u128.from(setPrice), u128.from(3)))
			buy(bob, tokenId, u128.from(5))
		}).toThrow()
	})

	it('Should addBidMarketData for token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(carol)

		const setPrice = '10000000000000000000000000'
		VMContext.setAttached_deposit(u128.add(u128.mul(u128.from(setPrice), u128.from(10)), 
									u128.from(bidFee)))
		addBidMarketData(carol, tokenId, quantity, u128.from(setPrice))

		const bidMarketData_ = getBidMarketData(bob, tokenId)
		if (bidMarketData_) {
			expect(bidMarketData_.quantity).toBe(quantity)
			expect(bidMarketData_.price).toBe(u128.from(setPrice))
		}
	})

	it('Should removeBidMarketPrice for token', () => {
		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(carol)

		const setPrice = '10000000000000000000000000'
		VMContext.setAttached_deposit(u128.add(u128.mul(u128.from(setPrice), u128.from(10)), 
									u128.from(bidFee)))
		addBidMarketData(carol, tokenId, quantity, u128.from(setPrice))

		deleteBidMarketData(carol, tokenId)
		const bidMarketData_ = getBidMarketData(carol, tokenId)
		expect(bidMarketData_).toBe(null)
	})

	it('Should accept bid from bid marketplace', () => {
		VMContext.setStorage_usage(100)

		VMContext.setPredecessor_account_id(alice)
		const tokenId = '1'
		const quantity = u128.from(10)
		mintTo(bob, tokenId, quantity)

		VMContext.setPredecessor_account_id(carol)

		const setPrice = '10000000000000000000000000'
		// carol wants 5 NFT with price 1 NEAR each
		VMContext.setAttached_deposit(u128.add(u128.mul(u128.from(setPrice), u128.from(5)), 
									u128.from(bidFee)))
		addBidMarketData(
			carol,
			tokenId,
			u128.from(5),
			u128.from(setPrice)
		)

		VMContext.setPredecessor_account_id(bob)
		// bob only wants to fulfill 3 NFT from carol
		acceptBidMarketData(
			carol, 
			tokenId,
			u128.from(3)
		)

		const bobBal_ = balanceOf(bob, tokenId)
		const carolBal_ = balanceOf(carol, tokenId)
		expect(bobBal_).toBe(u128.from(7))
		expect(carolBal_).toBe(u128.from(3))

		const updatedMarketData = getBidMarketData(carol, tokenId)
		if (updatedMarketData) {
			expect(updatedMarketData.quantity).toBe(u128.from(2))
			expect(updatedMarketData.price).toBe(u128.from(setPrice))
		}
	})
})
