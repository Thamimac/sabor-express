// Gerador de QR Code (padrão ISO/IEC 18004), sem bibliotecas externas.
// Modo byte, correção de erros nível M, versões 1 a 10 (até ~200 caracteres). Uso: QR.svg('https://...')
const QR = (() => {
  // Tabelas do nível M para as versões 1 a 10 (índice 0 não é usado)
  const ECC_POR_BLOCO = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const BITS_FORMATO_M = 0;

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function modulosDeDados(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const palavrasDeDados = (v) => Math.floor(modulosDeDados(v) / 8) - ECC_POR_BLOCO[v] * NUM_BLOCOS[v];

  // ---- Reed-Solomon sobre GF(256) ----
  function multiplicar(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(grau) {
    const r = new Array(grau).fill(0);
    r[grau - 1] = 1;
    let raiz = 1;
    for (let i = 0; i < grau; i += 1) {
      for (let j = 0; j < r.length; j += 1) {
        r[j] = multiplicar(r[j], raiz);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      raiz = multiplicar(raiz, 0x02);
    }
    return r;
  }
  function resto(dados, div) {
    const r = div.map(() => 0);
    for (const b of dados) {
      const fator = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= multiplicar(c, fator); });
    }
    return r;
  }

  function gerar(texto) {
    const bytes = [...new TextEncoder().encode(texto)];
    let versao = 1;
    for (; versao <= 10; versao += 1) {
      const bitsContagem = versao <= 9 ? 8 : 16;
      if (4 + bitsContagem + bytes.length * 8 <= palavrasDeDados(versao) * 8) break;
    }
    if (versao > 10) throw new Error('Texto muito longo para o QR Code');
    const tamanho = versao * 4 + 17;

    // ---- Montagem dos bits: modo byte (0100) + contagem + dados + terminador + preenchimento ----
    const bits = [];
    const adicionar = (valor, n) => { for (let i = n - 1; i >= 0; i -= 1) bits.push((valor >>> i) & 1); };
    adicionar(4, 4);
    adicionar(bytes.length, versao <= 9 ? 8 : 16);
    bytes.forEach((b) => adicionar(b, 8));
    const capacidade = palavrasDeDados(versao) * 8;
    adicionar(0, Math.min(4, capacidade - bits.length));
    adicionar(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacidade; pad ^= 0xec ^ 0x11) adicionar(pad, 8);
    const dados = [];
    for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // ---- Correção de erros e intercalação dos blocos ----
    const numBlocos = NUM_BLOCOS[versao];
    const eccLen = ECC_POR_BLOCO[versao];
    const total = Math.floor(modulosDeDados(versao) / 8);
    const curtos = numBlocos - (total % numBlocos);
    const tamCurto = Math.floor(total / numBlocos);
    const div = divisor(eccLen);
    const blocos = [];
    for (let i = 0, k = 0; i < numBlocos; i += 1) {
      const dat = dados.slice(k, k + tamCurto - eccLen + (i < curtos ? 0 : 1));
      k += dat.length;
      const ecc = resto(dat, div);
      if (i < curtos) dat.push(0);
      blocos.push(dat.concat(ecc));
    }
    const final = [];
    for (let i = 0; i < blocos[0].length; i += 1) {
      blocos.forEach((b, j) => { if (i !== tamCurto - eccLen || j >= curtos) final.push(b[i]); });
    }

    // ---- Padrões fixos (localizadores, sincronismo, alinhamento) ----
    const m = Array.from({ length: tamanho }, () => new Array(tamanho).fill(false));
    const fixo = Array.from({ length: tamanho }, () => new Array(tamanho).fill(false));
    const marcar = (x, y, escuro) => { m[y][x] = escuro; fixo[y][x] = true; };
    for (let i = 0; i < tamanho; i += 1) { marcar(6, i, i % 2 === 0); marcar(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [tamanho - 4, 3], [3, tamanho - 4]]) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx; const y = cy + dy;
          if (x >= 0 && x < tamanho && y >= 0 && y < tamanho) marcar(x, y, d !== 2 && d !== 4);
        }
      }
    }
    if (versao > 1) {
      const n = Math.floor(versao / 7) + 2;
      const passo = Math.ceil((versao * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = tamanho - 7; pos.length < n; p -= passo) pos.splice(1, 0, p);
      pos.forEach((x, i) => pos.forEach((y, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) marcar(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const desenharFormato = (mascara) => {
      const dado = (BITS_FORMATO_M << 3) | mascara;
      let r = dado;
      for (let i = 0; i < 10; i += 1) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((dado << 10) | r) ^ 0x5412;
      for (let i = 0; i <= 5; i += 1) marcar(8, i, bit(b, i));
      marcar(8, 7, bit(b, 6)); marcar(8, 8, bit(b, 7)); marcar(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i += 1) marcar(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i += 1) marcar(tamanho - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i += 1) marcar(8, tamanho - 15 + i, bit(b, i));
      marcar(8, tamanho - 8, true);
    };
    desenharFormato(0); // reserva a área (os bits certos são gravados depois de escolher a máscara)
    if (versao >= 7) {
      let r = versao;
      for (let i = 0; i < 12; i += 1) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (versao << 12) | r;
      for (let i = 0; i < 18; i += 1) {
        const a = tamanho - 11 + (i % 3); const c = Math.floor(i / 3);
        marcar(a, c, bit(b, i)); marcar(c, a, bit(b, i));
      }
    }

    // ---- Posiciona os dados em zigue-zague ----
    let i = 0;
    for (let direita = tamanho - 1; direita >= 1; direita -= 2) {
      if (direita === 6) direita = 5;
      for (let vert = 0; vert < tamanho; vert += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = direita - j;
          const subindo = ((direita + 1) & 2) === 0;
          const y = subindo ? tamanho - 1 - vert : vert;
          if (!fixo[y][x] && i < final.length * 8) { m[y][x] = bit(final[i >>> 3], 7 - (i & 7)); i += 1; }
        }
      }
    }

    // ---- Máscara: testa as 8 e fica com a de menor penalidade ----
    const regras = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const aplicar = (k) => { for (let y = 0; y < tamanho; y += 1) for (let x = 0; x < tamanho; x += 1) if (!fixo[y][x] && regras[k](x, y)) m[y][x] = !m[y][x]; };
    const penalidade = () => {
      let p = 0;
      for (let a = 0; a < tamanho; a += 1) {
        for (const linha of [(k) => m[a][k], (k) => m[k][a]]) {
          let seq = 1;
          for (let k = 1; k < tamanho; k += 1) {
            if (linha(k) === linha(k - 1)) { seq += 1; if (seq === 5) p += 3; else if (seq > 5) p += 1; } else seq = 1;
          }
        }
      }
      for (let y = 0; y < tamanho - 1; y += 1) for (let x = 0; x < tamanho - 1; x += 1) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
      const escuros = m.flat().filter(Boolean).length;
      p += Math.floor(Math.abs(escuros * 20 - tamanho * tamanho * 10) / (tamanho * tamanho)) * 10;
      return p;
    };
    let melhor = 0; let menor = Infinity;
    for (let k = 0; k < 8; k += 1) {
      aplicar(k); desenharFormato(k);
      const p = penalidade();
      if (p < menor) { menor = p; melhor = k; }
      aplicar(k); // desfaz
    }
    aplicar(melhor);
    desenharFormato(melhor);
    return m;
  }

  // Desenha como SVG (com a margem branca de 4 módulos exigida pelo padrão)
  function svg(texto, { tamanho = 200, margem = 4 } = {}) {
    const m = gerar(texto);
    const n = m.length + margem * 2;
    let caminho = '';
    m.forEach((linha, y) => linha.forEach((escuro, x) => { if (escuro) caminho += `M${x + margem},${y + margem}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${tamanho}" height="${tamanho}" shape-rendering="crispEdges" role="img" aria-label="QR Code">`
      + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
  }

  return { gerar, svg };
})();