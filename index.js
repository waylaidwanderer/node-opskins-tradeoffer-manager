const deepEqual = require('deep-equal');
const request = require('request-promise');
const twoFactor = require('node-2fa');

const { EventEmitter } = require('events');

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
            this.pollData.offers = await this.getOffers(fullUpdate, offersSince);
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

    async sendOffer(offer) {
        offer.twofactor_code = twoFactor.generateToken(this.twoFactorSecret).token;
        const url = 'https://api-trade.opskins.com/ITrade/SendOfferToSteamId/v1/';
        const data = await this.makeOpskinsRequest({
            method: 'POST',
            url,
            form: offer,
            json: true,
        });
        return data.response.offer;
    }

    async cancelOffer(offerId) {
        const url = 'https://api-trade.opskins.com/ITrade/CancelOffer/v1/';
        const data = await this.makeOpskinsRequest({
            method: 'POST',
            url,
            form: {
                offer_id: offerId,
            },
            json: true,
        });
        return data.response.offer;
    }

    async getOffer(offerId) {
        const url = `https://api-trade.opskins.com/ITrade/GetOffer/v1/?offer_id=${offerId}`;
        const data = await this.makeOpskinsRequest({
            method: 'GET',
            url,
            json: true,
        });
        return data.response.offer;
    }

    async getOffers(fullUpdate, historicalCutoff, page = 1, mergeOffers = []) {
        const data = await this._getOffers({
            page,
        });
        let offers;
        let returnEarly = false;
        if (fullUpdate) {
            // eslint-disable-next-line prefer-destructuring
            offers = data.response.offers;
        } else {
            offers = data.response.offers.filter(offer => offer.state === ETradeOfferState.Active || offer.time_updated >= historicalCutoff);
            returnEarly = Boolean(data.response.offers.find(offer => offer.time_updated < historicalCutoff));
        }

        mergeOffers = mergeOffers.concat(offers);
        if (returnEarly || page + 1 > data.total_pages) {
            return mergeOffers;
        }
        return this.getOffers(fullUpdate, historicalCutoff, page + 1, mergeOffers);
    }

    _getOffers(opt) {
        const url = 'https://api-trade.opskins.com/ITrade/GetOffers/v1/';
        return this.makeOpskinsRequest({
            method: 'GET',
            url,
            form: opt,
            json: true,
        });
    }

    async getInventory(opt = {}, page = 1, mergeItems = []) {
        opt.page = page;
        const data = await this._getInventory(opt);
        mergeItems = mergeItems.concat(data.response.items);
        if (page + 1 > data.total_pages) {
            return mergeItems;
        }
        return this.getInventory(opt, page + 1, mergeItems);
    }

    _getInventory(opt) {
        const url = 'https://api-trade.opskins.com/IUser/GetInventory/v1/';
        return this.makeOpskinsRequest({
            method: 'GET',
            url,
            qs: opt,
            json: true,
        });
    }
}
TradeOfferManager.ETradeOfferState = ETradeOfferState;
module.exports = TradeOfferManager;
