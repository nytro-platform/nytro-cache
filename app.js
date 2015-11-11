/*
    TODO:
        0.2.0 Add suporte para preservar headers de cookies entre a requisição e a resposta (no mesmo request, preservar o header de cookie quando a resposta estiver cacheada - gerar um token para cada request/response?)
        0.3.0 Habilitar/desabilitar rotas específicas através de configuração
        0.4.0 Add API REST básica para receber comandos de configuração do sistema de cache
        0.5.0 Add load balancer para multiplos hosts alvos com suporte a RoundRobin e "probe url"
*/
var NYTRO_CACHE_VERSION = '0.1.0';

var http = require('http');
var zlib = require('zlib');

var httpProxy = require('http-proxy');
var redis = require('redis');

if(!fs.fileExistsSync(__dirname + '/config.js')){
    throw Error('O arquivo de configuração "config.js" não foi criado ainda.');
}

var config = require('./config');
var proxy = httpProxy.createProxyServer();
var contentTypesEnabled = ['text/html', 'text/css', 'application/x-javascript'];
var redisClient = redis.createClient(config.redis ? config.redis : null);

// A cada recebimento de um response do host alvo
proxy.on('proxyRes', function (proxyRes, req, res) {

    // Se não é 200, retorna
    if (proxyRes.statusCode !== 200) return;

    // Se o content-type for do tipo texto (não-binário), colocamos em cache
    var canCache = false;
    contentTypesEnabled.forEach(function(item){
        if(proxyRes.headers['content-type'].match(item)){
            canCache = true;
        }
    });

    // Verifica a url requisitada está na lista de rotas desabilitadas para o cache
    if(canCache && config.routes && config.routes.disable && config.routes.disable.length){
        config.routes.disable.forEach(function(uri){
            if(req.url.match(uri)){
                console.log('Ignoring cache for URI ' + req.url);
                canCache = false;
            }
        });
    }

    // Verifica a url requisitada está na lista de rotas habilitadas para o cache
    if(canCache && config.routes && config.routes.enable && config.routes.enable.length){
        config.routes.enable.forEach(function(uri){
            if(req.url.match(uri)){
                canCache = true;
            }
        });
    }

    // Response pode entrar em cache?
    if(canCache){

        var chunks = [];

        // Para cada parte do response
        proxyRes.on('data', function(chunk) {
            chunks.push(chunk);
        });

        // Ao finalizar, descomprime, caso necessário, e envia para cache no Redis
        proxyRes.on('end', function() {
            var buffer = Buffer.concat(chunks);
            var encoding = proxyRes.headers['content-encoding'];

            // Se está compactado com Gzip
            if (encoding == 'gzip') {
                // Descomprime
                zlib.gunzip(buffer, function(err, decoded) {
                    if(err) console.log('ZLIB Gunzip Error: ' + err);
                    cacheResponse(req.url, proxyRes, decoded.toString());
                });
            } else if (encoding == 'deflate') { // Ou está compactado com Deflate
                // Descomprime
                zlib.inflate(buffer, function(err, decoded) {
                    if(err) console.log('ZLIB Deflate Error: ' + err);
                    cacheResponse(req.url, proxyRes, decoded.toString());
                });
            } else {
                // Não está compactado
                cacheResponse(req.url, proxyRes, buffer.toString());
            }
        });

    }
});

// Exibe a tela de erros
proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Ocorreu um erro no proxy com a aplicação.');
});

// Envia os dados do response para o cache no Redis
function cacheResponse(url, proxyRes, body){
    var cacheObj = {};
    cacheObj.url = url;
    cacheObj.status = proxyRes.statusCode;
    cacheObj.headers = JSON.stringify(proxyRes.headers);
    cacheObj.body = body;

    var cacheKey = cacheObj.url;
    redisClient.hmset(cacheKey, cacheObj);

    // Se existir a opção de TTL configurada
    if(config && config.ttl){
        redisClient.expire(cacheKey, parseInt(config.ttl));
    }
}

// Transforma headers como "content-type" em "Content-Type"
var camelCaseHeader = function (header) {
    return header.split('-').map(function (word) {
        return word[0].toUpperCase() + word.slice(1);
    }).join('-');
};

// Cria o server para receber as requisições
var server = http.createServer(function(req, res){

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
                if(req.url.match(/\.html/)) console.log(req.url);
                proxy.web(req, res, { target: config.target });
            }
        });
    } else {
        // Enviar para o host diretamente
        console.log('Proxy request method ' + req.method + ' for ' + req.url);
        proxy.web(req, res, { target: config.target });
    }

}).listen(config.port ? config.port : 8080, function(){
    // Mensagem de inćio do server
    console.log('Cache server listening on ' + server.address().port);
});
