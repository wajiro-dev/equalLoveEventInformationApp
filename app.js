const express = require('express');
const session = require('express-session');
const { Issuer, generators } = require('openid-client');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: 'auto',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24時間
    }
}));

app.set('view engine', 'ejs');

// OpenID Connectクライアントの初期化
let client;
let authParams;

async function initOpenIDClient() {
    try {
        const userPoolId = process.env.USER_POOL_ID;
        const region = userPoolId.split('_')[0];
        const clientId = process.env.COGNITO_CLIENT_ID;
        const clientSecret = process.env.COGNITO_CLIENT_SECRET;
        const redirectUri = process.env.COGNITO_REDIRECT_URI || `http://localhost:${PORT}/callback`;

        // OpenID Connectディスカバリーエンドポイントを直接指定
        const issuerUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/openid-configuration`;
        const issuer = await Issuer.discover(issuerUrl);
        
        client = new issuer.Client({
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uris: [redirectUri],
            response_types: ['code'],
        });

        authParams = {
            scope: 'openid email profile',
        };

        console.log('OpenID Connectクライアント初期化完了');
    } catch (error) {
        console.error('OpenID Connectクライアント初期化エラー:', error);
    }
}

// スクレイピング関数
async function fetchEventInfo() {
    try {
        const response = await fetch('https://equal-love.jp/news/list/6');
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const infoList = [];
        
        $('.infoList li').each((_, elem) => {
            const aTag = $(elem).find('a');
            const href = aTag.attr('href');
            const title = aTag.find('.tit').text().trim();
            const date = aTag.find('.date')
                .clone()
                .children()
                .remove()
                .end()
                .text()
                .trim();

            if (title.includes('FC')) {
                infoList.push({
                    title,
                    date,
                    href: `https://equal-love.jp${href}`
                });
            }
        });

        return infoList;
    } catch (error) {
        console.error('スクレイピングエラー:', error);
        return [];
    }
}

// ルート
app.get('/info', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const events = await fetchEventInfo();
        res.render('info', { 
            user: req.session.user,
            events: events
        });
    } catch (error) {
        console.error('イベント取得エラー:', error);
        res.render('info', { 
            user: req.session.user,
            events: []
        });
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/auth', async (req, res) => {
    if (!client) {
        return res.status(500).send('OpenID Connectクライアントが初期化されていません');
    }

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    
    req.session.codeVerifier = codeVerifier;

    console.log('[auth] start', {
        sessionId: req.sessionID,
        hasCodeVerifier: !!req.session.codeVerifier,
        host: req.get('host'),
        xForwardedProto: req.get('x-forwarded-proto')
    });

    const authUrl = client.authorizationUrl({
        ...authParams,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    if (!client) {
        return res.status(500).send('OpenID Connectクライアントが初期化されていません');
    }

    const { code } = req.query;
    const codeVerifier = req.session.codeVerifier;

    console.log('[callback] received', {
        sessionId: req.sessionID,
        hasCode: !!code,
        hasCodeVerifier: !!codeVerifier,
        host: req.get('host'),
        xForwardedProto: req.get('x-forwarded-proto')
    });

    if (!codeVerifier) {
        console.error('[callback] missing codeVerifier in session');
        return res.redirect('/login?error=session_lost');
    }

    try {
        const tokenSet = await client.callback(
            process.env.COGNITO_REDIRECT_URI || `http://localhost:${PORT}/callback`,
            { code },
            { code_verifier: codeVerifier }
        );

        const userInfo = await client.userinfo(tokenSet.access_token);
        
        req.session.user = {
            sub: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name
        };
        
        delete req.session.codeVerifier;

        res.redirect('/info');
    } catch (error) {
        console.error('コールバックエラー:', error);
        res.redirect('/login?error=auth_failed');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('セッション破棄エラー:', err);
        }
        res.clearCookie('connect.sid');

        const clientId = process.env.COGNITO_CLIENT_ID;
        const cognitoDomain = process.env.COGNITO_DOMAIN;
        const logoutRedirect = process.env.COGNITO_LOGOUT_URI
            || (process.env.COGNITO_REDIRECT_URI
                ? process.env.COGNITO_REDIRECT_URI.replace(/\/callback$/, '/login')
                : `http://localhost:${PORT}/login`);

        if (cognitoDomain && clientId) {
            const url = `${cognitoDomain.replace(/\/$/, '')}/logout`
                + `?client_id=${encodeURIComponent(clientId)}`
                + `&logout_uri=${encodeURIComponent(logoutRedirect)}`;
            return res.redirect(url);
        }

        res.redirect('/login');
    });
});

// サーバー起動
initOpenIDClient().then(() => {
    app.listen(PORT, () => {
        console.log(`サーバーが起動しました: http://localhost:${PORT}`);
    });
}).catch(error => {
    console.error('サーバー起動エラー:', error);
});
