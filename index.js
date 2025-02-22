const { Telegraf } = require('telegraf');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { Jupiter, TOKEN_LIST_URL } = require('@jup-ag/api');
const bs58 = require('bs58');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const users = {};

async function initJupiter(connection) {
    const jupiter = new Jupiter({
        connection,
        cluster: 'mainnet-beta',
        tokenList: await (await fetch(TOKEN_LIST_URL)).json(),
    });
    return jupiter;
}

bot.start((ctx) => ctx.reply("Chao ban! Day la bot sao chep giao dich Solana.\nDung /setup de nhap thong tin."));

bot.command('setup', async (ctx) => {
    const userId = ctx.from.id;
    users[userId] = { step: 'privateKey' };
    await ctx.reply("Gui tao PRIVATE_KEY cua vi Solana (base58):");
});

bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user) return;

    if (user.step === 'privateKey') {
        user.privateKey = ctx.message.text.trim();
        try {
            user.wallet = Keypair.fromSecretKey(bs58.decode(user.privateKey));
            user.connection = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');
            ctx.reply(`Vi: ${user.wallet.publicKey.toString()}\nGui tao TARGET_WALLET (public key):`);
            user.step = 'targetWallet';
        } catch (error) {
            ctx.reply(`Loi: PRIVATE_KEY khong dung. Chi tiet: ${error.message}\nDung /setup lai.`);
            delete users[userId];
        }
    } else if (user.step === 'targetWallet') {
        user.targetWallet = ctx.message.text.trim();
        try {
            user.targetWalletPublicKey = new PublicKey(user.targetWallet);
            ctx.reply(`Vi muc tieu: ${user.targetWallet}\nGui % sao chep (1-100):`);
            user.step = 'copyPercentage';
        } catch (error) {
            ctx.reply("Loi: TARGET_WALLET khong dung. Dung /setup lai.");
            delete users[userId];
        }
    } else if (user.step === 'copyPercentage') {
        user.copyPercentage = parseFloat(ctx.message.text) || 1;
        ctx.reply(`Gui slippage (bps, vi du 50 = 0.5%):`);
        user.step = 'slippage';
    } else if (user.step === 'slippage') {
        user.slippageBps = parseInt(ctx.message.text) || 50;
        user.jupiter = await initJupiter(user.connection);
        ctx.reply(`Cau hinh xong:\n- Vi: ${user.wallet.publicKey}\n- Vi muc tieu: ${user.targetWallet}\n- % sao chep: ${user.copyPercentage}%\n- Slippage: ${user.slippageBps / 100}%\nDung /start_monitor de chay.`);
        user.step = 'done';
    }
});

bot.command('start_monitor', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || user.step !== 'done') return ctx.reply("Chua thiet lap. Dung /setup truoc.");
    if (user.isMonitoring) return ctx.reply("Bot dang chay!");
    user.isMonitoring = true;
    ctx.reply("Dang giam sat vi muc tieu...");
    user.connection.onAccountChange(user.targetWalletPublicKey, async () => {
        const signatures = await user.connection.getConfirmedSignaturesForAddress2(user.targetWalletPublicKey, { limit: 1 });
        if (signatures.length > 0) {
            const txSignature = signatures[0].signature;
            ctx.reply(`Phat hien giao dich: ${txSignature}`);
            await analyzeAndCopyTransaction(txSignature, ctx, user);
        }
    }, "confirmed");
});

async function analyzeAndCopyTransaction(signature, ctx, user) {
    try {
        const tx = await user.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) return;
        const instructions = tx.transaction.message.instructions;
        for (const ix of instructions) {
            if (ix.programId.toString() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
                const parsed = ix.parsed;
                if (parsed.type === "transfer") {
                    const amount = parsed.info.amount;
                    const mint = parsed.info.mint;
                    ctx.reply(`Chuyen ${amount} token ${mint}`);
                    await copyTrade(mint, amount, ctx, user);
                }
            }
        }
    } catch (error) {
        ctx.reply(`Loi phan tich: ${error.message}`);
    }
}

async function copyTrade(tokenMint, amount, ctx, user) {
    try {
        const inputMint = new PublicKey("So11111111111111111111111111111111111111112");
        const outputMint = new PublicKey(tokenMint);
        const adjustedAmount = Math.floor((amount * (user.copyPercentage / 100)) * 0.01 * 1e9);
        const routes = await user.jupiter.computeRoutes({
            inputMint: inputMint.toString(),
            outputMint: outputMint.toString(),
            amount: adjustedAmount,
            slippageBps: user.slippageBps,
        });
        const { execute } = await user.jupiter.exchange({
            routeInfo: routes.routesInfos[0],
            userPublicKey: user.wallet.publicKey,
        });
        const txid = await execute();
        ctx.reply(`Sao chep thanh cong: https://solscan.io/tx/${txid}`);
    } catch (error) {
        ctx.reply(`Loi sao chep: ${error.message}`);
    }
}

bot.command('stop', (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || !user.isMonitoring) return ctx.reply("Bot chua chay!");
    user.isMonitoring = false;
    ctx.reply("Bot da dung.");
});

bot.command('status', (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user) return ctx.reply("Chua thiet lap. Dung /setup truoc.");
    ctx.reply(`Trang thai:\n- Vi: ${user.wallet ? user.wallet.publicKey.toString() : "Chua thiet lap"}\n- Vi muc tieu: ${user.targetWallet || "Chua thiet lap"}\n- % sao chep: ${user.copyPercentage}%\n- Slippage: ${user.slippageBps / 100}%\n- Dang chay: ${user.isMonitoring ? "Co" : "Khong"}`);
});

bot.launch();
console.log("Bot chay roi! Moi nguoi dung /setup de nhap thong tin.");
