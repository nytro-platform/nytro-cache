module.exports = {
    port: 8080,
    target: 'http://local.website.com/',
    ttl: 3600,
    routes: {
        enable: [
            '/customer/account/login'
        ],
        disable: [
            '/pcomm/info',
            '/index.php/admin',
            '/admin',
            '/adminhtml',
            '/customer',
            '/checkout',
            '/sales/order',
            '/contacts',
            '/boleto'
        ]
    },
    redis: {
        host: 'localhost',
        port: 6370
    }
};
