import 'dotenv/config'

import ws from "ws";
import { performance } from "perf_hooks";
global.WebSocket = ws;
global.performance = performance;

import { createExchange } from "safe-cex";
import { EMA } from "technicalindicators";
import { OrderSide, OrderType } from "./const.js";
import { tokens } from './tokens.js';

const exchange = process.env.EXCHANGE || 'binance';
const apiKey = process.env.API_KEY || '';
const apiSecret = process.env.API_SECRET || '';
const intervalMinutes = Number(process.env.REPEAT_INTERVAL_MINUTES) || 15;
const KLINE_INTERVAL = process.env.KLINE_INTERVAL || '1h';

const app = createExchange(exchange, {
    key: apiKey,
    secret: apiSecret,
    extra: {
        tickInterval: 20000,
    },
});

app.on("error", (err) => {
    console.error(err);
});

app.on("log", (message, severity) => {
    console.log(`[EXCHANGE] [${severity}] ${message}`);
});

const TOTAL_USDT_AMOUNT = Number(process.env.TOTAL_USDT_AMOUNT) || 100_000;
const ORDERS_COUNT = Number(process.env.ORDERS_COUNT) || 5;


const fetchHistoricalData = async (token) => {
    const data = await app.fetchOHLCV({
        symbol: token,
        interval: KLINE_INTERVAL,
    });

    return data;
};

const calculateEMA = (values, period) => {
    const emaLine = EMA.calculate({ values, period });
    const last = emaLine[emaLine.length - 1];
    return last;
};

const tokenLoop = async (token) => {
    // dont run if an order filled
    const hasPosition = app.store.positions.some(
        (p) => p.symbol === token.symbol && p.contracts !== 0
    );

    if (hasPosition) {
        console.log(`[BOT] FOUND POSITION FOR ${token.symbol} SKIPPING\n\n`);
        return;
    }

    console.log(`[BOT] PROCESSING ${token.symbol}`);

    const kline = await fetchHistoricalData(token.symbol);
    const closes = kline.map((k) => k.close);
    let priceTarget = calculateEMA(closes, token.ema);

    console.log(`[BOT] ${token.symbol} PRICE TARGET: $${priceTarget.toFixed(4)}`);

    // remove existing limit orders
    await app.cancelSymbolOrders(token.symbol);

    const tradeRangeHigh = parseFloat(process.env.TRADE_RANGE_BETWEEN_PERCENTAGE_HIGH) || 1.01;
    const tradeRangeLow = parseFloat(process.env.TRADE_RANGE_BETWEEN_PERCENTAGE_LOW) || 0.99;

    // generate 10 limit orders in range of +- 1% of EMA 200
    const high = priceTarget * tradeRangeHigh;
    const low = priceTarget * tradeRangeLow;

    const amount = TOTAL_USDT_AMOUNT / tokens.length / priceTarget / ORDERS_COUNT;
    const buyLimitOrders = [];

    for (let i = 0; i < ORDERS_COUNT; i++) {
        const price = low + ((high - low) * i) / ORDERS_COUNT;
        buyLimitOrders.push({
            symbol: token.symbol,
            side: OrderSide.Buy,
            price,
            amount,
            type: OrderType.Limit,
        });
    }

    await app.placeOrders(buyLimitOrders);
    console.log(`[BOT] ${token.symbol} LIMIT ORDERS PLACED\n\n`);

    setTimeout(() => tokenLoop(token), (intervalMinutes || 1) * 60 * 1000);
};

const main = async () => {
    console.log("[BOT] STARTING");
    console.log("[BOT] LOADING EXCHANGE");
    await app.start();

    console.log("[BOT] EXCHANGE LOADED");
    console.log("[BOT] CREATE LIMIT ORDERS\n\n");

    for (const token of tokens) {
        await tokenLoop(token);
    }
};

main();