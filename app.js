var http = require('http');
var httpProxy = require('http-proxy');
var zlib = require('zlib');

var redis = require('redis');
var redisClient = redis.createClient();

var target = 'http://local.menuespecial.com.br:8081';

var NYTRO_CACHE_VERSION = '0.1.0';
var proxy = httpProxy.createProxyServer();
var contentTypesEnabled = ['text/html', 'text/css', 'application/x-javascript'];

proxy.on('proxyRes', function (proxyRes, req, res) {
    // Se não é 200, retorna
    if (proxyRes.statusCode !== 200) return

    // Se o content-type for texto, colocamos em cache
    var canCache = false;
    contentTypesEnabled.forEach(function(item){
        if(proxyRes.headers['content-type'].match(item)){
            canCache = true;
        }
    });

    if(canCache){

        var chunks = [];

        proxyRes.on('data', function(chunk) {
            chunks.push(chunk);
        });

        proxyRes.on('end', function() {
            var buffer = Buffer.concat(chunks);
            var encoding = proxyRes.headers['content-encoding'];

            if (encoding == 'gzip') {
                zlib.gunzip(buffer, function(err, decoded) {
                    if(err) console.log('ZLIB Gunzip Error: ' + err);
                    cacheResponse(req.url, proxyRes, decoded.toString());
                });
            } else if (encoding == 'deflate') {
                zlib.inflate(buffer, function(err, decoded) {
                    if(err) console.log('ZLIB Deflate Error: ' + err);
                    cacheResponse(req.url, proxyRes, decoded.toString());
                });
            } else {
                cacheResponse(req.url, proxyRes, buffer.toString());
            }
        });

    }
});

proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Ocorreu um erro no proxy com a aplicação.');
});

function cacheResponse(url, proxyRes, body){
    var cacheObj = {};
    cacheObj.url = url;
    cacheObj.status = proxyRes.statusCode;
    cacheObj.headers = JSON.stringify(proxyRes.headers);
    cacheObj.body = body;

    var cacheKey = cacheObj.url;
    redisClient.hmset(cacheKey, cacheObj);
}

var upcaseFirstLetter = function (word) {
  return word[0].toUpperCase() + word.slice(1)
}

var camelCaseHeader = function (header) {
  return header.split('-').map(upcaseFirstLetter).join('-')
}

// Cria o server para receber as requisições
http.createServer(function(req, res){

    // Somente se for uma requisição GET
    if(req.method === 'GET'){
        // Se tem a versão em cache da requisição
        var cacheKey = req.url;
        redisClient.hgetall(cacheKey, function(err, cache) {

            // Se não tiver erro na resposta do Redis e houver cache disponível
            if(!err && cache){
                console.log('Serving cached version of: ' + req.url);

                // Envia o novo response
                var headers = JSON.parse(cache.headers);
                headers['X-Nytro-Cache'] = NYTRO_CACHE_VERSION;
                delete headers['content-encoding'];
                res.writeHead(200, headers);
                res.end(cache.body);

            } else {
                // Log do erro, se houver
                if(err) console.log('RedisClient Error:' + err);

                // Se não, envia diretamente
                proxy.web(req, res, { target: target });
            }
        });
    } else {
        // Enviar para o proxy diretamente
        proxy.web(req, res, { target: target });
    }

}).listen(8080, function(){
    // Mensagem de init do server
    console.log('Cache server listening on 8080');
});
