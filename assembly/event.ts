import { PersistentVector } from 'near-sdk-as'

const events = new PersistentVector<Event>('events2')

export type Event = string[]
export const EVENT_TRANSFER = 'Transfer'
export const EVENT_TRANSFER_BATCH = 'TransferBatch'
export const EVENT_APPROVAL = 'Approval'
export const EVENT_OWNERSHIP_TRANSFERRED = 'OwnershipTransferred'
export const EVENT_MARKET_UPDATE = 'MarketUpdate'
export const EVENT_MARKET_DELETE = 'MarketDelete'
export const EVENT_MARKET_BUY = 'MarketBuy'
export const EVENT_BID_MARKET_ADD = 'BidMarketAdd'
export const EVENT_BID_MARKET_DELETE = 'BidMarketDelete'
export const EVENT_BID_MARKET_ACCEPT = 'BidMarketAccept'

export function _getEvent(index: i32): Event {
	return events[index]
}

export function _getEventHeight(): i32 {
	return events.length
}

export function pushEvent(params: string[]): void {
	const event: Event = params
	events.push(event)
}
