const { Telegraf, Markup } = require('telegraf'); // Thêm Markup cho nút menu
const { Connection, Keypair, PublicKey, Commitment } = require('@solana/web3.js');
const { create } = require('@jup-ag/api'); // S? d?ng create thay vì constructor Jupiter
const bs58 = require('bs58'); // Ð?m b?o import dúng

const bot = new Telegraf("YOUR_TELEGRAM_BOT_TOKEN_HERE"); // Thay token th?t
const users = {};

async function initJupiter(connection) {
    return await create({ connection, cluster: 'mainnet-beta' }); // S? d?ng create d? kh?i t?o Jupiter
}

// Hàm gi? l?p giá SOL (thay b?ng API giá th?t n?u c?n, ví d? CoinGecko)
function getSolPrice() {
    return 100; // Giá SOL gi? d?nh (USD), thay d?i th?c t? qua API
}

bot.start((ctx) => {
    const keyboard = Markup.keyboard([
        ['Menu']
    ]).resize();
    ctx.reply("Chao ban! Day la bot Anh Thu Dep Gai sao chep Solana.\nDung /setup de nhap thong tin hoac nhan Menu de mo menu.", keyboard);
});

bot.hears('Menu', (ctx) => {
    const userId = ctx.from.id;
    const keyboard = Markup.keyboard([
        ['Them vi moi'],
        ['Them vi dich moi'], // Nút m?i: Thêm ví dích m?i
        ['Bat dau sao chep', 'Dung sao chep'],
        ['Trang thai']
    ]).resize();
    ctx.reply("Chon chuc nang:", keyboard);
});

bot.hears('Them vi moi', (ctx) => {
    const userId = ctx.from.id;
    if (!users[userId]) users[userId] = { wallets: [], tradeHistory: [], recentTransactions: new Map() };
    users[userId].step = 'privateKey';
    ctx.reply("Bot da su dung PRIVATE_KEY cua ban. Gui PRIVATE_KEY (base58):");
    users[userId].step = 'privateKey';
});

bot.hears('Them vi dich moi', (ctx) => { // X? lý nút m?i: Thêm ví dích m?i
    const userId = ctx.from.id;
    if (!users[userId]) users[userId] = { wallets: [], tradeHistory: [], recentTransactions: new Map() };
    const subMenu = Markup.keyboard([
        ['Nhap PRIVATE_KEY'],
        ['Nhap TARGET_WALLET'],
        ['Nhap % sao chep'],
        ['Nhap slippage'],
        ['Nhap gia tri toi thieu'],
        ['Quay lai']
    ]).resize();
    ctx.reply("Chon muc de them vi dich moi:", subMenu);
    users[userId].step = 'newTargetWalletMenu';
});

bot.hears(['Nhap PRIVATE_KEY', 'Nhap TARGET_WALLET', 'Nhap % sao chep', 'Nhap slippage', 'Nhap gia tri toi thieu', 'Quay lai'], (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || user.step !== 'newTargetWalletMenu') return;

    if (ctx.message.text === 'Quay lai') {
        const mainMenu = Markup.keyboard([
            ['Them vi moi'],
            ['Them vi dich moi'],
            ['Bat dau sao chep', 'Dung sao chep'],
            ['Trang thai']
        ]).resize();
        ctx.reply("Tro ve menu chinh:", mainMenu);
        delete user.step;
        return;
    }

    switch (ctx.message.text) {
        case 'Nhap PRIVATE_KEY':
            ctx.reply("Gui PRIVATE_KEY (base58):");
            user.step = 'newPrivateKey';
            break;
        case 'Nhap TARGET_WALLET':
            ctx.reply("Gui TARGET_WALLET (public key) moi:");
            user.step = 'newTargetWallet';
            break;
        case 'Nhap % sao chep':
            ctx.reply("Gui % sao chep (1-100):");
            user.step = 'newCopyPercentage';
            break;
        case 'Nhap slippage':
            ctx.reply("Gui slippage (bps, vi du 50 = 0.5%):");
            user.step = 'newSlippage';
            break;
        case 'Nhap gia tri toi thieu':
            ctx.reply("Gui gia tri toi thieu de sao chep lenh mua SOL (vi du 0.1):");
            user.step = 'newMinBuyAmount';
            break;
    }
});

bot.hears('Bat dau sao chep', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || !user.wallets.length) return ctx.reply("Chua thiet lap vi. Dung /setup truoc.");
    user.wallets.forEach(wallet => wallet.isMonitoring = true);
    ctx.reply("Dang giam sat tat ca cac vi...");
    user.wallets.forEach(wallet => pollWallet(user, ctx, wallet));
    startStatusUpdates(user, ctx); // B?t d?u g?i thông báo tr?ng thái 5 phút/l?n
});

bot.hears('Dung sao chep', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || !user.wallets.length) return ctx.reply("Chua thiet lap vi. Dung /setup truoc.");
    user.wallets.forEach(wallet => wallet.isMonitoring = false);
    ctx.reply("Da dung giam sat tat ca cac vi.");
    clearInterval(user.statusInterval); // D?ng g?i thông báo tr?ng thái
});

bot.command('setup', async (ctx) => {
    const userId = ctx.from.id;
    if (!users[userId]) users[userId] = { wallets: [], tradeHistory: [], recentTransactions: new Map() };
    await ctx.reply("Gui PRIVATE_KEY (base58):");
    users[userId].step = 'privateKey';
});

bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user) return;

    if (user.step === 'privateKey') {
        user.privateKey = ctx.message.text.trim();
        try {
            const decodedKey = bs58.decode(user.privateKey);
            user.wallet = Keypair.fromSecretKey(new Uint8Array(decodedKey)); // S? d?ng Uint8Array
            user.connection = new Connection("https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY", 'processed'); // Thay API key
            user.tradeHistory = []; // Luu l?ch s? giao d?ch
            user.recentTransactions = new Map(); // Luu giao d?ch g?n dây (5 phút)
            ctx.reply(`Vi: ${user.wallet.publicKey}\nGui TARGET_WALLET (public key):`);
            user.step = 'targetWallet';
        } catch (error) {
            ctx.reply(`Loi: PRIVATE_KEY sai. Chi tiet: ${error.message}\nDung /setup lai.`);
            delete users[userId];
        }
    } else if (user.step === 'targetWallet') {
        user.targetWallet = ctx.message.text.trim();
        try {
            const targetWalletPublicKey = new PublicKey(user.targetWallet);
            user.wallets.push({ publicKey: targetWalletPublicKey, isMonitoring: false, minBuyAmount: 0.1, copyPercentage: 1, slippageBps: 50 });
            ctx.reply(`Da them vi muc tieu: ${user.targetWallet}\nGui % sao chep (1-100):`);
            user.step = 'copyPercentage';
        } catch (error) {
            ctx.reply("Loi: TARGET_WALLET sai. Dung /setup lai.");
            delete users[userId];
        }
    } else if (user.step === 'copyPercentage') {
        user.wallets[user.wallets.length - 1].copyPercentage = parseFloat(ctx.message.text) || 1;
        ctx.reply(`Gui slippage (bps, vi du 50 = 0.5%):`);
        user.step = 'slippage';
    } else if (user.step === 'slippage') {
        user.wallets[user.wallets.length - 1].slippageBps = parseInt(ctx.message.text) || 50;
        ctx.reply(`Gui gia tri toi thieu de sao chep lenh mua SOL (vi du 0.1):`);
        user.step = 'minBuyAmount';
    } else if (user.step === 'minBuyAmount') {
        user.wallets[user.wallets.length - 1].minBuyAmount = parseFloat(ctx.message.text) || 0.1;
        user.wallets[user.wallets.length - 1].jupiter = await initJupiter(user.connection);
        ctx.reply(`Cau hinh xong vi ${user.targetWallet}:\n- % sao chep: ${user.wallets[user.wallets.length - 1].copyPercentage}\n- Slippage: ${user.wallets[user.wallets.length - 1].slippageBps / 100}\n- Gia tri toi thieu lenh mua: ${user.wallets[user.wallets.length - 1].minBuyAmount} SOL\nDung /start_monitor de bat dau, /stop_monitor de dung.`);
        user.step = 'done';
    } else if (user.step === 'newPrivateKey') { // X? lý PRIVATE_KEY cho ví dích m?i
        user.newPrivateKey = ctx.message.text.trim();
        try {
            const decodedKey = bs58.decode(user.newPrivateKey);
            user.newWallet = Keypair.fromSecretKey(new Uint8Array(decodedKey)); // S? d?ng Uint8Array
            user.connection = new Connection("https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY", 'processed'); // Thay API key
            ctx.reply(`Vi moi: ${user.newWallet.publicKey}\nGui TARGET_WALLET (public key) moi:`);
            user.step = 'newTargetWallet';
        } catch (error) {
            ctx.reply(`Loi: PRIVATE_KEY sai. Chi tiet: ${error.message}\nChon lai 'Nhap PRIVATE_KEY' de thu lai.`);
            delete user.newPrivateKey;
            delete user.newWallet;
        }
    } else if (user.step === 'newTargetWallet') {
        user.newTargetWallet = ctx.message.text.trim();
        try {
            const newTargetWalletPublicKey = new PublicKey(user.newTargetWallet);
            user.wallets.push({ publicKey: newTargetWalletPublicKey, isMonitoring: false, minBuyAmount: 0.1, copyPercentage: 1, slippageBps: 50 });
            ctx.reply(`Da them vi dich moi: ${user.newTargetWallet}\nGui % sao chep (1-100):`);
            user.step = 'newCopyPercentage';
        } catch (error) {
            ctx.reply("Loi: TARGET_WALLET sai. Chon lai 'Nhap TARGET_WALLET' de thu lai.");
            delete user.newTargetWallet;
        }
    } else if (user.step === 'newCopyPercentage') {
        user.wallets[user.wallets.length - 1].copyPercentage = parseFloat(ctx.message.text) || 1;
        ctx.reply(`Gui slippage (bps, vi du 50 = 0.5%):`);
        user.step = 'newSlippage';
    } else if (user.step === 'newSlippage') {
        user.wallets[user.wallets.length - 1].slippageBps = parseInt(ctx.message.text) || 50;
        ctx.reply(`Gui gia tri toi thieu de sao chep lenh mua SOL (vi du 0.1):`);
        user.step = 'newMinBuyAmount';
    } else if (user.step === 'newMinBuyAmount') {
        user.wallets[user.wallets.length - 1].minBuyAmount = parseFloat(ctx.message.text) || 0.1;
        user.wallets[user.wallets.length - 1].jupiter = await initJupiter(user.connection);
        ctx.reply(`Cau hinh xong vi dich moi ${user.newTargetWallet}:\n- % sao chep: ${user.wallets[user.wallets.length - 1].copyPercentage}\n- Slippage: ${user.wallets[user.wallets.length - 1].slippageBps / 100}\n- Gia tri toi thieu lenh mua: ${user.wallets[user.wallets.length - 1].minBuyAmount} SOL\nChon 'Quay lai' de tro ve menu chinh.`);
        user.step = 'newTargetWalletDone';
    }
});

bot.command('start_monitor', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || !user.wallets.length) return ctx.reply("Chua thiet lap vi. Dung /setup truoc.");
    user.wallets.forEach(wallet => wallet.isMonitoring = true);
    ctx.reply("Dang giam sat tat ca cac vi...");
    user.wallets.forEach(wallet => pollWallet(user, ctx, wallet));
    startStatusUpdates(user, ctx); // B?t d?u g?i thông báo tr?ng thái 5 phút/l?n
});

bot.command('stop_monitor', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user || !user.wallets.length) return ctx.reply("Chua thiet lap vi. Dung /setup truoc.");
    user.wallets.forEach(wallet => wallet.isMonitoring = false);
    ctx.reply("Da dung giam sat tat ca cac vi.");
    clearInterval(user.statusInterval); // D?ng g?i thông báo tr?ng thái
});

bot.hears('Trang thai', async (ctx) => {
    const userId = ctx.from.id;
    const user = users[userId];
    if (!user) return ctx.reply("Chua thiet lap. Dung /setup truoc.");
    const walletStatuses = user.wallets.map(w => {
        const recentTx = getRecentTransactions(user, w.publicKey.toString(), 5 * 60 * 1000); // 5 phút
        const txDetails = recentTx.length > 0 ? recentTx.map(tx => `Ma GD: ${tx.txid}, Gia tri: ${tx.action === "Mua" ? `Mua ${tx.amount} SOL` : `Ban ${tx.amount} SOL`}`).join('\n') :
