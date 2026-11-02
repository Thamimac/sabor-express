// Carrinho de compras guardado no navegador (localStorage) até o pedido ser enviado
const Carrinho = {
  chave: 'sabor-express-carrinho',

  ler() {
    try { return JSON.parse(localStorage.getItem(this.chave)) || []; } catch { return []; }
  },
  salvar(itens) {
    try { localStorage.setItem(this.chave, JSON.stringify(itens)); } catch { /* navegador sem armazenamento */ }
    document.dispatchEvent(new CustomEvent('carrinho'));
  },
  adicionar(item) {
    const itens = this.ler();
    const linha = itens.find((i) => i.item_id === item.id);
    if (linha) linha.quantidade = Math.min(20, linha.quantidade + 1);
    else itens.push({ item_id: item.id, nome: item.nome, preco_centavos: item.preco_centavos, quantidade: 1, observacao: '' });
    this.salvar(itens);
  },
  alterar(itemId, delta) {
    const itens = this.ler();
    const linha = itens.find((i) => i.item_id === itemId);
    if (!linha) return;
    linha.quantidade = Math.max(0, Math.min(20, linha.quantidade + delta));
    this.salvar(itens.filter((i) => i.quantidade > 0));
  },
  observar(itemId, observacao) {
    const itens = this.ler();
    const linha = itens.find((i) => i.item_id === itemId);
    if (linha) { linha.observacao = observacao; this.salvar(itens); }
  },
  quantidadeDe(itemId) { return this.ler().find((i) => i.item_id === itemId)?.quantidade || 0; },
  limpar() { this.salvar([]); },
  total() { return this.ler().reduce((s, i) => s + i.preco_centavos * i.quantidade, 0); },
  contar() { return this.ler().reduce((s, i) => s + i.quantidade, 0); },
};