// Micro-framework HTTP sem dependências externas: rotas, JSON, cookies e arquivos estáticos.
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./erros');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

// Cabeçalhos de segurança aplicados a todas as respostas (RNF Segurança)
const HEADERS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
};

function parseCookies(header = '') {
  const cookies = {};
  for (const parte of header.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const nome = parte.slice(0, i).trim();
    if (!nome) continue;
    try {
      cookies[nome] = decodeURIComponent(parte.slice(i + 1).trim());
    } catch {
      cookies[nome] = parte.slice(i + 1).trim();
    }
  }
  return cookies;
}

function lerCorpo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > limite) {
        reject(new HttpError(413, 'Requisição muito grande'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function enviarJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

class App {
  constructor({ publicDir } = {}) {
    this.rotas = [];
    this.middlewares = [];
    this.publicDir = publicDir ? path.resolve(publicDir) : null;
  }

  use(fn) {
    this.middlewares.push(fn);
  }

  rota(metodo, caminho, ...handlers) {
    const nomes = [];
    const padrao = caminho.replace(/\/:([a-zA-Z_]+)/g, (_, nome) => {
      nomes.push(nome);
      return '/([^/]+)';
    });
    this.rotas.push({ metodo, re: new RegExp(`^${padrao}/?$`), nomes, handlers });
  }

  get(...a) { this.rota('GET', ...a); }
  post(...a) { this.rota('POST', ...a); }
  put(...a) { this.rota('PUT', ...a); }
  patch(...a) { this.rota('PATCH', ...a); }
  delete(...a) { this.rota('DELETE', ...a); }

  encontrar(metodo, caminho) {
    let caminhoExiste = false;
    for (const r of this.rotas) {
      const m = r.re.exec(caminho);
      if (!m) continue;
      caminhoExiste = true;
      if (r.metodo !== metodo) continue;
      const params = {};
      r.nomes.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { rota: r, params };
    }
    if (caminhoExiste) throw new HttpError(405, 'Método não permitido');
    throw new HttpError(404, 'Recurso não encontrado');
  }

  handler() {
    return (req, res) => this.processar(req, res);
  }

  async processar(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let caminho;
    try { caminho = decodeURIComponent(url.pathname); } catch { caminho = url.pathname; }
    const ctx = {
      req,
      res,
      url,
      caminho,
      metodo: req.method,
      query: Object.fromEntries(url.searchParams),
      params: {},
      cookies: parseCookies(req.headers.cookie),
      ip: req.socket?.remoteAddress || '',
      body: {},
      usuario: null,
      status: 200,
      encerrado: false,
    };
    for (const [k, v] of Object.entries(HEADERS_SEGURANCA)) res.setHeader(k, v);

    try {
      if (caminho.startsWith('/api/')) {
        const { rota, params } = this.encontrar(req.method, caminho);
        ctx.params = params;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const bruto = await lerCorpo(req);
          if (bruto.trim()) {
            // Exigir JSON também protege contra CSRF via formulários HTML
            if (!(req.headers['content-type'] || '').includes('application/json')) {
              throw new HttpError(415, 'Envie os dados no formato JSON');
            }
            try { ctx.body = JSON.parse(bruto); } catch { throw new HttpError(400, 'JSON inválido'); }
            if (ctx.body === null || typeof ctx.body !== 'object') ctx.body = {};
          }
        }
        for (const mw of this.middlewares) await mw(ctx);
        let resultado;
        for (const h of rota.handlers) {
          resultado = await h(ctx);
          if (ctx.encerrado) return;
        }
        if (res.writableEnded) return;
        enviarJson(res, ctx.status, resultado === undefined ? { ok: true } : resultado);
      } else {
        await this.servirEstatico(ctx);
      }
    } catch (e) {
      if (!(e instanceof HttpError)) console.error('[erro]', e);
      if (res.headersSent) { res.end(); return; }
      enviarJson(res, e.status || 500, {
        erro: e instanceof HttpError ? e.message : 'Erro interno no servidor',
        ...(e.detalhes ? { detalhes: e.detalhes } : {}),
      });
    }
  }

  async servirEstatico(ctx) {
    const { req, res } = ctx;
    if (!this.publicDir) throw new HttpError(404, 'Não encontrado');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');
    let rel = ctx.caminho;
    if (rel.endsWith('/')) rel += 'index.html';
    let arquivo = path.normalize(path.join(this.publicDir, rel));
    if (!arquivo.startsWith(this.publicDir)) throw new HttpError(403, 'Acesso negado');
    if (!path.extname(arquivo)) {
      if (existeArquivo(`${arquivo}.html`)) arquivo += '.html';
      else if (existeArquivo(path.join(arquivo, 'index.html'))) arquivo = path.join(arquivo, 'index.html');
    }
    let status = 200;
    if (!existeArquivo(arquivo)) {
      arquivo = path.join(this.publicDir, '404.html');
      status = 404;
      if (!existeArquivo(arquivo)) { res.writeHead(404); res.end('Não encontrado'); return; }
    }
    const ext = path.extname(arquivo).toLowerCase();
    res.writeHead(status, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(arquivo).pipe(res);
  }
}

function existeArquivo(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

module.exports = { App, HttpError, enviarJson, parseCookies };