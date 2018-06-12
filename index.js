const deepEqual = require('deep-equal');
const request = require('request-promise');
const twoFactor = require('node-2fa');

const { EventEmitter } = require('events');
const SteamID = require('steamid');

const ETradeOfferState = require('./ETradeOfferState');

const MINIMUM_POLL_INTERVAL = 1000;

class TradeOfferManager extends EventEmitter {
    constructor(opt) {
        super();

        this.apiKey = opt.apiKey;
        this.twoFactorSecret = opt.twoFactorSecret;
        this.pollInterval = opt.pollInterval || 5000;
        this.request = request.defaults({
            auth: {
                user: this.apiKey,
                password: '',
                sendImmediately: true,
            },
        });
        this.pollData = opt.pollData || {
            offers: [],
            offersSince: 0,
        };
        this.cancelTime = opt.cancelTime;

        this.lastPoll = 0;
        this.doPoll();
    }

    async doPoll() {
        if (!this.apiKey) return;

        if (this.lastPoll > 0) {
            const timeSinceLastPoll = Date.now() - this.lastPoll;
            if (timeSinceLastPoll < MINIMUM_POLL_INTERVAL) {
                // We last polled less than a second ago... we shouldn't spam the API
                // Reset the timer to poll minimumPollInterval after the last one
                this.resetPollTimer(MINIMUM_POLL_INTERVAL - timeSinceLastPoll);
                return;
            }
        }

        this.lastPoll = Date.now();
        clearTimeout(this.pollTimer);

        const { offersSince } = this.pollData;

        let fullUpdate = false;
        if (!offersSince) {
            fullUpdate = true;
        }

        const oldPollData = JSON.parse(JSON.stringify(this.pollData));

        this.emit('debug', `Doing trade offer poll since ${offersSince}${fullUpdate ? ' (full update)' : ''}`);
        try {
            const offers = await this._getOffersForPolling(fullUpdate, offersSince);
            offers.forEach((offer) => {
                const oldOfferIndex = this.pollData.offers.findIndex(oldOffer => oldOffer.id === offer.id);
                if (oldOfferIndex === -1) {
                    this.pollData.offers.push(offer);
                } else {
                    this.pollData.offers[oldOfferIndex] = offer;
                }
            });
        } catch (err) {
            this.emit('debug', `Error getting trade offers for poll: ${err}`);
            this.emit('pollFailure', err);
            this.resetPollTimer();
            return;
        }

        const sent = this.pollData.offers.filter(offer => offer.sent_by_you);
        const received = this.pollData.offers.filter(offer => !offer.sent_by_you);

        sent.forEach(async (offer) => {
            const oldOffer = oldPollData.offers.find(_oldOffer => _oldOffer.id === offer.id);
            if (!oldOffer) {
                this.emit('unknownOfferSent', offer);
            } else if (offer.state !== oldOffer.state) {
                this.emit('sentOfferChanged', offer, oldOffer.state);
            }
            if (offer.state === ETradeOfferState.Active) {
                if (this.cancelTime && (Date.now() - (offer.time_updated * 1000)) >= this.cancelTime) {
                    try {
                        await this.cancelOffer(offer.id);
                        this.emit('sentOfferCanceled', offer, 'cancelTime');
                    } catch (err) {
                        this.emit('debug', `Can't auto-cancel offer #${offer.id}: ${err}`);
                    }
                }
            }
        });
        received.forEach((offer) => {
            const oldOffer = oldPollData.offers.find(_oldOffer => _oldOffer.id === offer.id);
            if (!oldOffer && offer.state === ETradeOfferState.Active) {
                this.emit('newOffer', offer);
            } else if (oldOffer && offer.state !== oldOffer.state) {
                this.emit('receivedOfferChanged', offer, oldOffer.state);
            }
        });

        let latest = offersSince;
        this.pollData.offers.forEach((offer) => {
            if (offer.time_updated > latest) {
                latest = offer.time_updated;
            }
        });
        this.pollData.offersSince = latest;

        this.emit('pollSuccess');

        if (!deepEqual(oldPollData, this.pollData)) {
            this.emit('pollData', this.pollData);
        }

        this.resetPollTimer();
    }

    resetPollTimer(time) {
        const pollInterval = time || this.pollInterval;
        if (pollInterval < MINIMUM_POLL_INTERVAL) return;
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(this.doPoll.bind(this), pollInterval);
    }

    async makeOpskinsRequest(opt) {
        const data = await this.request(opt);
        if (data.status !== 1) {
            throw new Error(data.message);
        }
        return data;
    }

    get(iface, method, version, data) {
        return this.makeOpskinsRequest({
            method: 'GET',
            url: `https://api-trade.opskins.com/${iface}/${method}/v${version}/`,
            qs: data,
            json: true,
        });
    }

    post(iface, method, version, data) {
        return this.makeOpskinsRequest({
            method: 'POST',
            url: `https://api-trade.opskins.com/${iface}/${method}/v${version}/`,
            form: data,
            json: true,
        });
    }

    async withdrawToOpskins(itemIds) {
        const data = await this.post('IItem', 'WithdrawToOpskins', 1, {
            item_id: itemIds.join(','),
        });
        return data.response;
    }

    async sendOffer(offer) {
        offer.twofactor_code = twoFactor.generateToken(this.twoFactorSecret).token;
        const data = await this.post('ITrade', 'SendOfferToSteamId', 1, offer);
        return data.response.offer;
    }

    async acceptOffer(offerId) {
        const data = await this.post('ITrade', 'AcceptOffer', 1, {
            twofactor_code: twoFactor.generateToken(this.twoFactorSecret).token,
            offer_id: offerId,
        });
        return data.response;
    }

    async cancelOffer(offerId) {
        const data = await this.post('ITrade', 'CancelOffer', 1, {
            offer_id: offerId,
        });
        return data.response.offer;
    }

    async getOffer(offerId) {
        const data = await this.get('ITrade', 'GetOffer', 1, {
            offer_id: offerId,
        });
        return data.response.offer;
    }

    async getOffers(filter, historicalCutoff = null, opt = {}, page = 1, mergeOffers = []) {
        opt.page = page;
        if (filter) {
            opt.state = filter;
        }
        const data = await this._getOffers(opt);
        let offers;
        let returnEarly = false;
        if (historicalCutoff) {
            offers = data.response.offers.filter(offer => offer.time_updated >= historicalCutoff);
            returnEarly = Boolean(data.response.offers.find(offer => offer.time_updated < historicalCutoff));
        } else {
            // eslint-disable-next-line prefer-destructuring
            offers = data.response.offers;
        }

        mergeOffers = mergeOffers.concat(offers);
        if (returnEarly || page + 1 > data.total_pages) {
            return mergeOffers;
        }
        return this.getOffers(filter, historicalCutoff, opt, page + 1, mergeOffers);
    }

    async _getOffersForPolling(fullUpdate, historicalCutoff, page = 1, mergeOffers = []) {
        const data = await this._getOffers({
            page,
        });
        let offers;
        let returnEarly = false;
        if (fullUpdate) {
            // eslint-disable-next-line prefer-destructuring
            offers = data.response.offers;
        } else {
            offers = data.response.offers.filter(offer => offer.state === ETradeOfferState.Active ||
                                                          offer.time_updated === offer.time_created ||
                                                          offer.time_updated >= historicalCutoff);
            returnEarly = Boolean(data.response.offers.find(offer => offer.time_updated < historicalCutoff));
        }

        mergeOffers = mergeOffers.concat(offers);
        if (returnEarly || page + 1 > data.total_pages) {
            return mergeOffers;
        }
        return this._getOffersForPolling(fullUpdate, historicalCutoff, page + 1, mergeOffers);
    }

    _getOffers(opt) {
        return this.get('ITrade', 'GetOffers', 1, opt);
    }

    async getInventory(appId, opt = {}, page = 1, mergeItems = []) {
        opt.app_id = appId;
        opt.page = page;
        const data = await this._getInventory(opt);
        mergeItems = mergeItems.concat(data.response.items);
        if (page + 1 > data.total_pages) {
            return mergeItems;
        }
        return this.getInventory(appId, opt, page + 1, mergeItems);
    }

    _getInventory(opt) {
        return this.get('IUser', 'GetInventory', 1, opt);
    }

    async getUserInventory(id, appId, opt = {}, page = 1, mergeItems = []) {
        const steamId = new SteamID(id);
        if (steamId.isValid()) {
            opt.steam_id = steamId.toString();
        } else {
            opt.uid = id;
        }
        opt.page = page;
        const data = await this._getUserInventory(opt);
        mergeItems = mergeItems.concat(data.response.items);
        if (page + 1 > data.total_pages) {
            return mergeItems;
        }
        return this.getUserInventory(id, appId, opt, page + 1, mergeItems);
    }

    _getUserInventory(opt) {
        if (opt.steam_id) {
            return this.get('ITrade', 'GetUserInventoryFromSteamId', 1, opt);
        }
        return this.get('ITrade', 'GetUserInventory', 1, opt);
    }
}
TradeOfferManager.ETradeOfferState = ETradeOfferState;
module.exports = TradeOfferManager;
