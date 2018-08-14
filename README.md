# node-opskins-tradeoffer-manager
Simple and sane [WAX ExpressTrade](https://trade.opskins.com) offer management

[![npm version](https://img.shields.io/npm/v/opskins-tradeoffer-manager.svg)](https://npmjs.com/package/opskins-tradeoffer-manager)
[![npm downloads](https://img.shields.io/npm/dm/opskins-tradeoffer-manager.svg)](http://npm-stat.com/charts.html?package=opskins-tradeoffer-manager)
[![npm downloads](https://img.shields.io/npm/dt/opskins-tradeoffer-manager.svg)](http://npm-stat.com/charts.html?package=opskins-tradeoffer-manager)
[![license](https://img.shields.io/npm/l/opskins-tradeoffer-manager.svg)](https://github.com/waylaidwanderer/node-opskins-tradeoffer-manager/blob/master/LICENSE.md)

# Contributing

Rule 1: Respect the ESLint config.

# API 

## Basic Use
```js
const TradeManager = require('opskins-tradeoffer-manager')

const manager = new TradeManager({
  apiKey: "", // opskins apiKey
  twoFactorSecret: "", // opskins 2fa secret
  pollInterval: "", // default is 5000
})

// listen for new offers.
manager.on("newOffer", offer => {

  manager.acceptOffer(offer.id).then(result => {
    // do somthing else...
  })

})
```

## Constructor(options)
Initialize your class and start the recursive polling loop.

* `apiKey` - Your opskins api key.
* `twoFactorSecret` - Your opskins twofactor secret.
* `pollInterval` - (*optional*) The rate you would like to check for new offers in ms.
* `pollData` - (*optional*) Provide polling data to resume a previous state.
* `cancelTime` - The amount of time to wait before a offer is automatically canceled.

```js
const TradeManager = require('opskins-tradeoffer-manager')
const manager = new TradeManager(options)
```

## Methods

### manager.doPoll()
Force polling check of the express trade api.
> Returns `null`

### manager.resetPollTimer(time)
Reset the wait timer for the recursive polling loop.
Returns `null`

* `time` - Set the time to wait between loops.

### manager.withdrawToOpskins(itemids)
Request withdraw of the items from your express trade inventory to opskins.
> Returns the express trade api result.

* `itemids` - Array of express trade item ids.

### manager.sendOffer(offer)
Send an express trade offer.
> Returns the created express trade offer.

* `offer` - A object containing the express trade offer options.

### manager.acceptOffer(offerid)
Accept an express trade offer.
> Returns the express trade api result.

* `offerid` - The id of the offer you would like to accept.

### manager.cancelOffer(offerid)
Cancel an express trade offer.
> Returns the canceled express trade offer.

* `offerid` - The id of the offer you would like to accept.

### manager.getOffer(offerid)
Get the state of an express trade offer.
> Returns the canceled express trade offer.

* `offerid` - The id of the offer you would like to accept.

### manager.getOffers(state, historicalCutoff, options)
Get a list of express trade offers.
> Returns a list the existing express trade offers.

* `state` - The state you would like to filter the results by.
* `historicalCutoff` - (*optional*) Filter and do not return offers past this time.
* `options` - (*optional*) Express trade options such as page.

### manager.getInventory(appid, options)
Get your express trade inventory.
> Returns the express trade api result.

* `appid` - The express trade appid you would like to get items for.
* `options` - (*optional*) Express trade options such as page.

### manager.getUserInventory(userid, appid, options)
Get another user's express trade inventory.
> Returns the express trade api result.

* `userid` - The express trade user's steamid or userid.
* `appid` - The express trade appid you would like to get items for.
* `options` - (*optional*) Express trade options such as page.

## Events
Various events will be emitted after a poll has taken place.

```js
manager.on("newOffer", offer => {
  // do somthing with the event...
})
```

### manager.on("pollFailure", error)
Emitted when a polling attempt fails.
> Emits the created error.

### manager.on("pollSuccess")
Emitted when a polling attempt succeeds.
> Emits `null`

### manager.on("pollData", state)
Emitted when the raw polling state changes.
> Emits the current state.

### manager.on("unknownOfferSent", offer)
Emitted when a sent offer is found that does not exist in our polling history.
> Emits the offer state.

### manager.on("sentOfferChanged", (newState, oldState))
Emitted when a existing sent offer changes state.
> Emits the updated and old offer state.

### manager.on("sentOfferCanceled", offer)
Emitted when a existing sent offer is canceled.
> Emits the offer state.

### manager.on("newOffer", offer)
Emitted when a new offer is recieved.
> Emits the offer state.

### manager.on("receivedOfferChanged", (newState, oldState))
Emitted when a existing recieved offer changes state.
> Emits the updated and old offer state.
