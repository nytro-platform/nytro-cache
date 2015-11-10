module.exports = {
    port: 4000,
    target: 'http://local.usenatureza.com:4001',
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
    }
};
