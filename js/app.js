// Consulta de legislação — aplicativo de página única, sem dependências.
// Rotas (hash):  #/            início
//                #/busca?q=…   busca em todas as leis
//                #/clt         leitura da lei
//                #/clt/477     leitura posicionada no artigo
//                #/clt?q=…     leitura com busca dentro da lei

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const app = $('#app');

// ---------- Preferências (localStorage protegido) ----------
const armazenamento = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem('leg:' + chave);
      return v === null ? padrao : JSON.parse(v);
    } catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem('leg:' + chave, JSON.stringify(valor)); } catch { /* modo privado */ }
  },
};

const prefs = {
  fonte: armazenamento.ler('fonte', 18),
  familia: armazenamento.ler('familia', 'serif'),
  tema: armazenamento.ler('tema', 'auto'),
  revogados: armazenamento.ler('revogados', false),
};
function aplicarPrefs() {
  const raiz = document.documentElement;
  raiz.style.setProperty('--fonte-leitura', prefs.fonte + 'px');
  raiz.dataset.fonte = prefs.familia;
  if (prefs.tema === 'auto') delete raiz.dataset.tema; else raiz.dataset.tema = prefs.tema;
  const texto = $('.texto-lei');
  if (texto) texto.classList.toggle('esconder-revogados', !prefs.revogados);
}
function salvarPref(chave, valor) {
  prefs[chave] = valor;
  armazenamento.gravar(chave, valor);
  aplicarPrefs();
}
aplicarPrefs();

// ---------- Utilidades de texto ----------
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Normaliza preservando o comprimento (1 caractere de entrada → 1 de saída),
// para que as posições encontradas na busca valham também no texto original.
const cacheNorm = new Map();
function normalizar(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = c.charCodeAt(0);
    if (code < 128) { out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : c; continue; }
    let n = cacheNorm.get(c);
    if (n === undefined) {
      n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (/[º°]/.test(c)) n = 'o';
      else if (/[ª]/.test(c)) n = 'a';
      else if (/[  -​]/.test(c)) n = ' ';
      else if (/[–—]/.test(c)) n = '-';
      if (n.length !== 1) n = n[0] || ' ';
      cacheNorm.set(c, n);
    }
    out += n;
  }
  return out;
}

const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas', 'que', 'por', 'para', 'com', 'um', 'uma', 'ao', 'aos', 'se']);

function prepararConsulta(q) {
  const frases = [];
  let resto = normalizar(q).replace(/"([^"]+)"/g, (_, f) => { if (f.trim()) frases.push(f.trim().replace(/\s+/g, ' ')); return ' '; });
  const termos = resto.split(/[\s,;]+/).map((t) => t.replace(/^[.:()]+|[.:()]+$/g, ''))
    .filter((t) => t && (t.length >= 2 || /\d/.test(t)) && !PALAVRAS_VAZIAS.has(t));
  const todos = [...frases, ...termos];
  return todos.length ? todos : null;
}

function encontrarOcorrencias(textoNorm, termos) {
  const faixas = [];
  for (const t of termos) {
    let i = textoNorm.indexOf(t);
    while (i !== -1) { faixas.push([i, i + t.length]); i = textoNorm.indexOf(t, i + t.length); }
  }
  return faixas;
}

const RE_NOTA = /\((?:\s*(?:Reda[çc][ãa]o dada|Reda[çc][ãa]o pela|Inclu[íi]d[oa]|Revogad[oa]|Vide|Acrescentad[oa]|Acrescid[oa]|Renumerad[oa]|Vig[êe]ncia|Regulamento|Regulamenta[çc][ãa]o|Promulga[çc][ãa]o|Produ[çc][ãa]o de efeito|Partes? mantidas?|Com reda[çc][ãa]o|Restabelecid|Suspens|Declarad|Revoga[çc][ãa]o|Express[ãa]o|Em vigor|Convers[ãa]o|Transformad|Inconstitucional|Vetad[oa]|VETAD[OA]|Mantid|Prorrogad|Ratificad|Retificad|Texto|Medida Provis|Execu[çc][ãa]o suspensa|Efic[áa]cia suspensa|Reproduzid))(?:[^()]|\([^()]*\))*\)/gi;
const RE_PREFIXO_ART = /^Art(?:igo)?s?\.?\s*(?:\d{1,2}(?:\.\d{3})+|\d{1,4})(?:[A-Z]{1,2}(?![A-Za-zÀ-ú]))?\s*(?:\.?\s*[º°o](?![a-zà-ú]))?(?:\s*-[A-Z]{1,2}(?![A-Za-zÀ-ú]))?\.?/;

function classeDoBloco(t) {
  if (/^(§|Par[áa]grafo [úu]nico)/i.test(t)) return 'par';
  if (/^[IVXLC]+\s*(?:[-–—]|\.\s)/.test(t)) return 'inc';
  if (/^[a-z]\)/.test(t)) return 'ali';
  if (/^\d{1,2}\s*[.)–-]\s/.test(t)) return 'item';
  return '';
}

// Gera o HTML de um bloco aplicando: trechos tachados, notas legislativas,
// marcação do número do artigo e destaques de busca.
const F_TACHADO = 1, F_NOTA = 2, F_MARCA = 4, F_ART = 8;
function htmlDoBloco(b, termos, uIdx) {
  const t = b.t;
  const flags = new Uint8Array(t.length);
  let tem = false;
  if (b.g) {
    let p = 0;
    for (const [seg, r] of b.g) { if (r) flags.fill(F_TACHADO, p, p + seg.length); p += seg.length; }
    tem = true;
  }
  RE_NOTA.lastIndex = 0;
  for (let m; (m = RE_NOTA.exec(t));) {
    for (let i = m.index; i < m.index + m[0].length; i++) flags[i] |= F_NOTA;
    tem = true;
  }
  if (b.k === 'a') {
    const m = RE_PREFIXO_ART.exec(t);
    if (m) { for (let i = 0; i < m[0].length; i++) flags[i] |= F_ART; tem = true; }
  }
  if (termos) {
    for (const [a, z] of encontrarOcorrencias(normalizar(t), termos)) {
      for (let i = a; i < z; i++) flags[i] |= F_MARCA;
      tem = true;
    }
  }
  if (!tem) return esc(t);
  let html = '';
  let ini = 0;
  for (let i = 1; i <= t.length; i++) {
    if (i < t.length && flags[i] === flags[ini]) continue;
    const f = flags[ini];
    let trecho = esc(t.slice(ini, i));
    if (f & F_MARCA) trecho = `<mark>${trecho}</mark>`;
    if (f & F_NOTA) trecho = `<span class="nota">${trecho}</span>`;
    if (f & F_TACHADO) trecho = `<s class="rev rev-seg">${trecho}</s>`;
    if (f & F_ART) trecho = `<span class="artnum" data-u="${uIdx}" role="button" tabindex="0">${trecho}</span>`;
    html += trecho;
    ini = i;
  }
  return html;
}

function textoLimpo(b, incluirRevogados) {
  let t = b.g && !incluirRevogados ? b.g.filter((s) => !s[1]).map((s) => s[0]).join('') : b.t;
  return t.replace(RE_NOTA, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

// ---------- Dados ----------
let catalogo = null;
let status = null;
const leisCarregadas = new Map();

async function carregarCatalogo() {
  if (catalogo) return catalogo;
  const [cat, st] = await Promise.all([
    fetch('leis.json').then((r) => r.json()),
    fetch('data/status.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  catalogo = cat;
  status = st;
  catalogo.porId = new Map(cat.leis.map((l) => [l.id, l]));
  return catalogo;
}

function nivelDoTitulo(t) {
  if (/^(PARTE|LIVRO|ATO DAS DISPOSI)/i.test(t)) return 1;
  if (/^T[ÍI]TULO/i.test(t)) return 2;
  if (/^CAP[ÍI]TULO/i.test(t)) return 3;
  if (/^SUBSE[ÇC][ÃA]O/i.test(t)) return 5;
  if (/^SE[ÇC][ÃA]O/i.test(t)) return 4;
  return 0;
}

function processarLei(meta, dados) {
  const unidades = [];
  const porArtigo = new Map();
  const caminho = []; // títulos ativos por nível
  let atual = null;

  for (const b of dados.blocos) {
    if (b.k === 'h') {
      if (!atual || atual.tipo !== 'h') {
        atual = { tipo: 'h', blocos: [], nivel: 0 };
        unidades.push(atual);
      }
      atual.blocos.push(b);
      const nv = nivelDoTitulo(b.t);
      if (nv) {
        atual.nivel = atual.nivel || nv;
        caminho.length = nv;
        caminho[nv - 1] = b.t;
      } else {
        const ult = caminho.length - 1;
        if (ult >= 0 && caminho[ult] && !caminho[ult].includes(' — ')) caminho[ult] += ' — ' + b.t;
      }
      continue;
    }
    if (b.k === 'a' || !atual || atual.tipo === 'h') {
      atual = { tipo: b.k === 'a' ? 'a' : 'p', blocos: [], art: b.a, ctx: caminho.filter(Boolean).join(' › ') };
      unidades.push(atual);
    }
    atual.blocos.push(b);
  }

  unidades.forEach((u, i) => {
    u.i = i;
    if (u.tipo === 'h') return;
    u.revogada = u.blocos.every((b) => b.s) || (u.tipo === 'a' && /^[^()]{0,40}\(\s*Revogad[oa]/i.test(u.blocos[0].t) && u.blocos.length === 1);
    u.todaTachada = u.blocos.every((b) => b.s);
    if (u.tipo === 'a') {
      const registrar = (n) => {
        if (!porArtigo.has(n)) porArtigo.set(n, []);
        porArtigo.get(n).push(u);
      };
      registrar(u.art);
      // "Art. 1.620 a 1.629 (Revogados)": qualquer número do intervalo leva a ele.
      const ate = u.blocos[0].ate;
      if (ate) for (let n = Number(u.art) + 1; n <= ate; n++) registrar(String(n));
    }
  });

  return { meta, dados, unidades, porArtigo };
}

async function carregarLei(id) {
  if (leisCarregadas.has(id)) return leisCarregadas.get(id);
  await carregarCatalogo();
  const meta = catalogo.porId.get(id);
  if (!meta) throw Object.assign(new Error('Lei não encontrada'), { codigo: 'desconhecida' });
  const resp = await fetch(`data/${id}.json`).catch(() => null);
  if (!resp || !resp.ok) throw Object.assign(new Error('Texto indisponível'), { codigo: 'indisponivel', meta });
  const lei = processarLei(meta, await resp.json());
  leisCarregadas.set(id, lei);
  return lei;
}

function textoNormDaUnidade(u, incluirRevogados) {
  const chave = incluirRevogados ? '_normR' : '_norm';
  if (u[chave] === undefined) {
    u[chave] = normalizar(u.blocos.filter((b) => incluirRevogados || !b.s).map((b) => (incluirRevogados || !b.g ? b.t : b.g.filter((s) => !s[1]).map((s) => s[0]).join(''))).join(' \n '));
  }
  return u[chave];
}

function buscarNaLei(lei, termos) {
  const res = [];
  for (const u of lei.unidades) {
    if (u.tipo === 'h') continue;
    if (!prefs.revogados && u.todaTachada) continue;
    const norm = textoNormDaUnidade(u, prefs.revogados);
    if (termos.every((t) => norm.includes(t))) res.push(u);
  }
  return res;
}

function trechoDaUnidade(u, termos) {
  const blocos = u.blocos.filter((b) => prefs.revogados || !b.s);
  const bruto = blocos.map((b) => textoLimpo(b, prefs.revogados)).join(' ');
  const norm = normalizar(bruto);
  let pos = Infinity;
  for (const t of termos) { const i = norm.indexOf(t); if (i !== -1 && i < pos) pos = i; }
  if (pos === Infinity) pos = 0;
  const ini = Math.max(0, pos - 70);
  const fim = Math.min(bruto.length, pos + 170);
  const parte = bruto.slice(ini, fim);
  const partNorm = norm.slice(ini, fim);
  const flags = new Uint8Array(parte.length);
  for (const [a, z] of encontrarOcorrencias(partNorm, termos)) flags.fill(1, a, z);
  let html = '';
  let k = 0;
  for (let i = 1; i <= parte.length; i++) {
    if (i < parte.length && flags[i] === flags[k]) continue;
    const s = esc(parte.slice(k, i));
    html += flags[k] ? `<mark>${s}</mark>` : s;
    k = i;
  }
  return (ini > 0 ? '… ' : '') + html + (fim < bruto.length ? ' …' : '');
}

// Entre versões do mesmo artigo, prefere a de nota de redação mais recente e
// evita as marcadas com vigência encerrada (ex.: MPs que caducaram).
function melhorVersao(lista) {
  const pontos = (u) => {
    const t = u.blocos.filter((b) => !b.s).map((b) => b.t).join(' ');
    let p = 0;
    if (/vig[êe]ncia (encerrada|suspensa)|efic[áa]cia suspensa|perdeu (a )?efic[áa]cia|rejeitad[oa]/i.test(t)) p -= 10000;
    if (/^[^()]{0,60}\(\s*revogad[oa]/i.test(t)) p -= 5000;
    // Ano mais recente nas notas "(Redação dada pela Lei nº …, de 9.12.1976)".
    const notas = t.match(/\((?:Reda[çc][ãa]o dada|Inclu[íi]d[oa]|Restabelecid[oa]|Acrescid[oa]|Renumerad[oa])[^()]*\)/gi) || [];
    const anos = notas.flatMap((n) => (n.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number));
    return p + (anos.length ? Math.max(...anos) : 0);
  };
  // Empate: a que vem por último no texto (o Planalto põe a mais nova depois).
  return lista.reduce((melhor, u) => (pontos(u) >= pontos(melhor) ? u : melhor));
}

function rotuloParte(lei, u) {
  const p = (lei.meta.partes || []).find((x) => normalizar(u.ctx || '').includes(normalizar(x.contexto)));
  return p ? `Art. ${u.art} do ${p.nome}` : `Art. ${u.art} da ${lei.meta.sigla}`;
}

function rotuloArtigo(lei, u) {
  if (u.tipo !== 'a') return lei.meta.sigla;
  const p = (lei.meta.partes || []).find((x) => normalizar(u.ctx || '').includes(normalizar(x.contexto)));
  return `${p ? p.nome : lei.meta.sigla}, art. ${u.art.replace(/^(\d+)/, (n) => Number(n).toLocaleString('pt-BR'))}`;
}

// ---------- Interpretação da busca do início ----------
function interpretar(q) {
  const norm = normalizar(q).replace(/(\d)\.(?=\d{3}\b)/g, '$1').replace(/(\d{3,5})\/\d{2,4}\b/g, '$1').replace(/\s+/g, ' ').trim();
  let melhor = null;
  for (const lei of catalogo.leis) {
    const apelidos = [lei.id, normalizar(lei.sigla).replace(/\./g, ''), ...lei.apelidos.map(normalizar)].map((a) => [a, null]);
    for (const p of lei.partes || []) apelidos.push([normalizar(p.apelido), p]);
    for (const [a, parte] of apelidos) {
      const re = new RegExp(`(^|[\\s,])(?:lei |decreto |dec |lc |ec )?(?:n[.o]* ?)?${a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|[\\s,.])`);
      const m = re.exec(norm);
      if (m && (!melhor || a.length > melhor.apelido.length)) melhor = { lei, apelido: a, m, parte };
    }
  }
  if (!melhor) return { tipo: 'busca', q };
  const resto = (norm.slice(0, melhor.m.index) + ' ' + norm.slice(melhor.m.index + melhor.m[0].length))
    .replace(/\b(arts?|artigos?)\b\.?/g, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const art = /^(\d{1,4})(?:\s*o\b)?(?:\s*-?\s*([a-z])\b)?/.exec(resto);
  if (art && resto.replace(art[0], '').trim().split(' ').filter(Boolean).every((p) => /^(inc|inciso|par|paragrafo|§|caput|alinea|[ivxlc]+|\d+o?|unico|[a-z]\)?)$/.test(p))) {
    return { tipo: 'artigo', lei: melhor.lei, parte: melhor.parte, art: art[2] ? `${art[1]}-${art[2].toUpperCase()}` : art[1] };
  }
  if (!resto) return { tipo: 'lei', lei: melhor.lei };
  return { tipo: 'buscaLei', lei: melhor.lei, q: resto };
}

// ---------- Favoritos e recentes ----------
const favoritos = () => armazenamento.ler('favoritos', []);
const recentes = () => armazenamento.ler('recentes', []);
function ehFavorito(lei, art) { return favoritos().some((f) => f.lei === lei && f.art === art); }
function alternarFavorito(lei, art) {
  let f = favoritos();
  if (ehFavorito(lei, art)) f = f.filter((x) => !(x.lei === lei && x.art === art));
  else f.unshift({ lei, art });
  armazenamento.gravar('favoritos', f.slice(0, 60));
}
function registrarRecente(lei, art) {
  const r = recentes().filter((x) => !(x.lei === lei && x.art === art));
  r.unshift({ lei, art: art || null });
  armazenamento.gravar('recentes', r.slice(0, 10));
}
function chipRef({ lei, art }) {
  const meta = catalogo.porId.get(lei);
  if (!meta) return '';
  return `<a class="chip" href="#/${lei}${art ? '/' + encodeURIComponent(art) : ''}"><b>${esc(meta.sigla)}</b>${art ? ' art. ' + esc(art) : ''}</a>`;
}

// ---------- Interface comum ----------
let avisoTimer;
function avisar(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.add('ver');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('ver'), 2400);
}

let painelOrigem = null;
function abrirPainel(titulo, html, aoMontar) {
  painelOrigem = document.activeElement;
  $('#painel-titulo').textContent = titulo;
  // Corpo novo a cada abertura, para não acumular listeners de painéis anteriores.
  const novo = $('#painel-corpo').cloneNode(false);
  $('#painel-corpo').replaceWith(novo);
  novo.innerHTML = html;
  $('#painel').hidden = false;
  aoMontar?.($('#painel-corpo'));
  ($('#painel-corpo').querySelector('button, a, input') || $('#painel .painel-topo button')).focus();
}
function fecharPainel() {
  $('#painel').hidden = true;
  painelOrigem?.focus?.();
}
$('#painel').addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharPainel(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#painel').hidden) fecharPainel(); });

function configurarTopo({ titulo = 'Legislação', voltar = false, indice = false } = {}) {
  $('#titulo-topo').textContent = titulo;
  $('#btn-voltar').hidden = !voltar;
  $('#btn-indice').hidden = !indice;
  document.title = titulo === 'Legislação' ? 'Legislação' : `${titulo} · Legislação`;
}
// Volta no histórico quando a página anterior é deste app; senão, vai ao início.
let navegacoes = 0;
$('#btn-voltar').addEventListener('click', () => {
  if (navegacoes > 1) history.back();
  else location.hash = '#/';
});

async function copiar(texto, msg = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* sem suporte */ }
    ta.remove();
  }
  avisar(msg);
}

function abrirPreferencias() {
  const seg = (nome, opcoes, atual) => `<div class="segmentado" data-pref="${nome}">${opcoes.map(([v, r]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(atual)}">${r}</button>`).join('')}</div>`;
  abrirPainel('Preferências de leitura', `
    <div class="config-linha"><span>Tamanho do texto</span>
      <div class="segmentado"><button type="button" data-fonte="-1" aria-label="Diminuir texto">A−</button><button type="button" data-fonte="0" aria-label="Tamanho padrão">${prefs.fonte}</button><button type="button" data-fonte="1" aria-label="Aumentar texto">A+</button></div></div>
    <div class="config-linha"><span>Fonte</span>${seg('familia', [['serif', 'Serifada'], ['sans', 'Sem serifa']], prefs.familia)}</div>
    <div class="config-linha"><span>Tema</span>${seg('tema', [['auto', 'Auto'], ['claro', 'Claro'], ['escuro', 'Escuro']], prefs.tema)}</div>
    <label class="config-linha"><span>Mostrar texto revogado/alterado<br><small style="color:var(--texto-2)">Redações antigas aparecem tachadas, como no Planalto</small></span>
      <input type="checkbox" class="interruptor" id="pref-revogados" ${prefs.revogados ? 'checked' : ''}></label>
  `, (corpo) => {
    corpo.addEventListener('click', (e) => {
      const f = e.target.closest('[data-fonte]');
      if (f) {
        const d = Number(f.dataset.fonte);
        salvarPref('fonte', d === 0 ? 18 : Math.min(28, Math.max(13, prefs.fonte + d)));
        corpo.querySelector('[data-fonte="0"]').textContent = prefs.fonte;
        return;
      }
      const b = e.target.closest('[data-pref] button');
      if (b) {
        const grupo = b.parentElement;
        salvarPref(grupo.dataset.pref, b.dataset.v);
        grupo.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }
    });
    corpo.querySelector('#pref-revogados').addEventListener('change', (e) => {
      salvarPref('revogados', e.target.checked);
      if (leitor.lei) leitor.renderizar({ manterPosicao: true });
    });
  });
}
$('#btn-config').addEventListener('click', abrirPreferencias);

// ---------- Tela inicial ----------
function telaInicio() {
  configurarTopo();
  leitor.lei = null;
  const st = status?.leis || {};
  const semDados = !status;
  const cartao = (l) => {
    const disponivel = semDados || st[l.id]?.artigos;
    return `<a class="cartao-lei${disponivel ? '' : ' indisponivel'}" href="#/${l.id}"><span class="sigla">${esc(l.sigla)}</span><span class="nome">${esc(l.nome)}</span></a>`;
  };
  const favs = favoritos().map(chipRef).join('');
  const recs = recentes().map(chipRef).join('');
  app.innerHTML = `
    <form class="busca-principal" id="form-busca" role="search">
      <svg class="campo-icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input class="campo" id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="CLT 477 · CC 186 · 8213 art 42 · férias" aria-label="Buscar artigo ou texto">
    </form>
    ${status && !Object.values(st).some((x) => x.artigos) ? '<div class="vazio" style="padding:12px 8px"><strong>Textos ainda não baixados</strong>A atualização automática ainda não rodou. Enquanto isso, cada lei mostra o link para a página oficial do Planalto.</div>' : ''}
    <p class="dica" id="dica">Digite a lei e o artigo (<code>CLT 477</code>, <code>CPC 300</code>) ou qualquer termo para buscar em todas as leis.</p>
    ${favs ? `<h2 class="secao-titulo">Favoritos</h2><div class="chips">${favs}</div>` : ''}
    ${recs ? `<h2 class="secao-titulo">Vistos recentemente</h2><div class="chips">${recs}</div>` : ''}
    ${catalogo.areas.map((a) => `
      <h2 class="secao-titulo">${esc(a.nome)}</h2>
      <div class="lista-leis">${catalogo.leis.filter((l) => l.area === a.id).map(cartao).join('')}</div>`).join('')}
    <p class="rodape">Textos obtidos do site oficial do Planalto (planalto.gov.br)${status?.geradoEm ? `, verificados em ${new Date(status.geradoEm).toLocaleDateString('pt-BR')}` : ''}. Em caso de dúvida, confira sempre a fonte oficial.</p>
  `;
  const campo = $('#q');
  const dica = $('#dica');
  const dicaPadrao = dica.innerHTML;
  campo.addEventListener('input', () => {
    const q = campo.value.trim();
    if (!q) { dica.innerHTML = dicaPadrao; return; }
    const r = interpretar(q);
    dica.innerHTML = '↵ ' + ({
      artigo: () => `Abrir <b>${esc(r.parte ? r.parte.nome : r.lei.sigla)}, art. ${esc(r.art)}</b>`,
      lei: () => `Abrir <b>${esc(r.lei.nome)}</b>`,
      buscaLei: () => `Buscar “${esc(r.q)}” em <b>${esc(r.lei.sigla)}</b>`,
      busca: () => `Buscar “${esc(q)}” em todas as leis`,
    })[r.tipo]();
  });
  $('#form-busca').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = campo.value.trim();
    if (!q) return;
    const r = interpretar(q);
    if (r.tipo === 'artigo') location.hash = `#/${r.lei.id}/${encodeURIComponent(r.art)}${r.parte ? '?parte=' + r.parte.apelido : ''}`;
    else if (r.tipo === 'lei') location.hash = `#/${r.lei.id}`;
    else if (r.tipo === 'buscaLei') location.hash = `#/${r.lei.id}?q=${encodeURIComponent(r.q)}`;
    else location.hash = `#/busca?q=${encodeURIComponent(q)}`;
  });
  if (matchMedia('(min-width: 700px)').matches) campo.focus();
}

// ---------- Busca em todas as leis ----------
let buscaGlobalId = 0;
async function telaBuscaGlobal(q) {
  configurarTopo({ titulo: 'Busca', voltar: true });
  leitor.lei = null;
  const minhaBusca = ++buscaGlobalId;
  app.innerHTML = `
    <form class="busca-principal" id="form-busca" role="search">
      <svg class="campo-icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input class="campo" id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" aria-label="Buscar em todas as leis">
    </form>
    <div class="progresso"><span style="width:0"></span></div>
    <div id="resumo" class="resumo-busca"></div>
    <div id="res"></div>`;
  $('#form-busca').addEventListener('submit', (e) => {
    e.preventDefault();
    const nova = $('#q').value.trim();
    if (!nova) return;
    const r = interpretar(nova);
    if (r.tipo === 'artigo') location.hash = `#/${r.lei.id}/${encodeURIComponent(r.art)}${r.parte ? '?parte=' + r.parte.apelido : ''}`;
    else if (r.tipo === 'lei') location.hash = `#/${r.lei.id}`;
    else if (r.tipo === 'buscaLei') location.hash = `#/${r.lei.id}?q=${encodeURIComponent(r.q)}`;
    else location.hash = `#/busca?q=${encodeURIComponent(nova)}`;
  });
  const termos = prepararConsulta(q);
  if (!termos) { $('#res').innerHTML = '<div class="vazio"><strong>Digite um termo para buscar</strong></div>'; return; }

  const barra = $('.progresso span');
  const res = $('#res');
  let total = 0, carregadas = 0, falhas = 0;
  const naoBaixada = (id) => status && !status.leis?.[id]?.artigos;
  for (const meta of catalogo.leis) {
    let lei;
    if (naoBaixada(meta.id)) falhas++;
    else {
      try { lei = await carregarLei(meta.id); } catch { falhas++; }
    }
    if (minhaBusca !== buscaGlobalId || !res.isConnected) return; // usuário saiu da tela
    carregadas++;
    barra.style.width = `${(carregadas / catalogo.leis.length) * 100}%`;
    if (!lei) continue;
    const achados = buscarNaLei(lei, termos);
    if (!achados.length) continue;
    total += achados.length;
    const qs = encodeURIComponent(q);
    const grupo = document.createElement('section');
    grupo.className = 'grupo-lei';
    grupo.innerHTML = `
      <h3><span class="sigla">${esc(meta.sigla)}</span> ${achados.length} resultado${achados.length > 1 ? 's' : ''}</h3>
      <div class="resultados">${achados.slice(0, 5).map((u) => cartaoResultado(lei, u, termos, qs)).join('')}</div>
      ${achados.length > 5 ? `<p><a class="botao" href="#/${meta.id}?q=${qs}">Ver todos os ${achados.length} em ${esc(meta.sigla)} →</a></p>` : ''}`;
    res.appendChild(grupo);
    $('#resumo').textContent = `${total} resultado${total > 1 ? 's' : ''} para “${q}”`;
  }
  if (minhaBusca !== buscaGlobalId || !res.isConnected) return;
  $('.progresso').hidden = true;
  if (!total) {
    res.innerHTML = `<div class="vazio"><strong>Nada encontrado para “${esc(q)}”</strong>Tente outras palavras, ou use aspas para buscar uma expressão exata.${falhas === catalogo.leis.length ? '<br><br>Os textos das leis ainda não foram baixados (veja o README).' : ''}</div>`;
  }
}

function cartaoResultado(lei, u, termos, qs) {
  const alvo = u.tipo === 'a' ? `${lei.meta.id}/${encodeURIComponent(u.art)}` : lei.meta.id;
  const dupl = u.tipo === 'a' && lei.porArtigo.get(u.art).length > 1 ? `&u=${u.i}` : '';
  return `<a class="resultado" href="#/${alvo}?q=${qs}${dupl}">
    ${u.ctx ? `<div class="ctx">${esc(u.ctx)}</div>` : ''}
    <div class="trecho">${u.tipo === 'a' ? `<b>Art. ${esc(u.art)}</b> · ` : ''}${trechoDaUnidade(u, termos)}</div></a>`;
}

// Rola até o elemento descontando o topo e a barra de busca fixos.
// Como o texto usa content-visibility (alturas estimadas fora da tela), a
// posição muda depois que os trechos são desenhados: corrige até estabilizar.
let rolagemId = 0;
function rolarPara(el) {
  if (!el) return;
  const id = ++rolagemId;
  const ajustar = (tentativa) => {
    if (id !== rolagemId) return;
    const fixo = ($('.topo')?.offsetHeight || 0) + ($('.barra-leitor')?.offsetHeight || 0) + 8;
    const delta = el.getBoundingClientRect().top - fixo;
    if (Math.abs(delta) > 2) window.scrollTo(0, window.scrollY + delta);
    if (tentativa < 12 && (Math.abs(delta) > 2 || tentativa < 2)) requestAnimationFrame(() => ajustar(tentativa + 1));
  };
  ajustar(0);
}

// ---------- Leitor ----------
const leitor = {
  lei: null,
  q: '',
  termos: null,
  achados: [],
  posicao: -1,

  async abrir(id, art, q, uForcada, parteId) {
    const mesmaLei = this.lei?.meta.id === id;
    if (!mesmaLei) {
      configurarTopo({ titulo: catalogo.porId.get(id)?.sigla || 'Lei', voltar: true });
      app.innerHTML = '<div class="vazio">Carregando…</div>';
      try {
        this.lei = await carregarLei(id);
      } catch (e) {
        this.lei = null;
        return telaIndisponivel(e, id, art);
      }
      configurarTopo({ titulo: this.lei.meta.sigla, voltar: true, indice: true });
      this.montar();
    }
    const qMudou = (q || '') !== this.q;
    this.q = q || '';
    this.termos = this.q ? prepararConsulta(this.q) : null;
    if (!mesmaLei || qMudou) {
      $('#campo-leitor').value = this.q;
      this.renderizar();
    }
    registrarRecente(id, art || null);
    if (!art) this.avisoArtigo(null);
    if (art) this.irParaArtigo(art, uForcada, (this.lei.meta.partes || []).find((p) => p.apelido === parteId));
    else if (this.termos && this.achados.length) this.irParaAchado(0);
    else if (!mesmaLei) window.scrollTo(0, 0);
  },

  montar() {
    const { meta, dados } = this.lei;
    const st = dados.alteradoEm ? new Date(dados.alteradoEm).toLocaleDateString('pt-BR') : null;
    const vf = dados.verificadoEm ? new Date(dados.verificadoEm).toLocaleDateString('pt-BR') : null;
    app.innerHTML = `
      <div class="barra-leitor">
        <form id="form-leitor" role="search">
          <svg class="campo-icone" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input class="campo" id="campo-leitor" type="search" enterkeyhint="go" autocomplete="off" placeholder="Nº do artigo ou palavra" aria-label="Ir para artigo ou buscar nesta lei">
          <button type="button" class="icone-btn limpar" id="limpar-leitor" aria-label="Limpar busca" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </form>
        <div id="resumo-leitor" class="resumo-busca" hidden></div>
        <div id="aviso-artigo" class="resumo-busca aviso-artigo" hidden></div>
      </div>
      <div class="cabecalho-lei">
        <h1>${esc(meta.nome)}</h1>
        <div class="meta">
          <span>${dados.artigos} artigos</span>
          ${vf ? `<span>Verificado no Planalto em ${vf}${st && st !== vf ? ` · última alteração detectada em ${st}` : ''}</span>` : ''}
          <a href="${esc(meta.url)}" target="_blank" rel="noopener">Abrir no Planalto ↗</a>
        </div>
      </div>
      <div class="texto-lei" id="texto-lei"></div>
      <button class="topo-pagina" id="topo-pagina" aria-label="Voltar ao topo" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>`;

    const campo = $('#campo-leitor');
    const limpar = $('#limpar-leitor');
    campo.addEventListener('input', () => { limpar.hidden = !campo.value; });
    limpar.addEventListener('click', () => { campo.value = ''; limpar.hidden = true; location.hash = `#/${meta.id}`; campo.focus(); });
    $('#form-leitor').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = campo.value.trim();
      campo.blur();
      if (!v) { location.hash = `#/${meta.id}`; return; }
      const m = /^(?:art(?:igo)?s?\.?\s*)?(\d{1,2}(?:\.\d{3})+|\d{1,4})\s*(?:[º°o]\b)?\s*(?:-?\s*([a-z])\b)?\s*\.?$/i.exec(v);
      if (m) {
        const art = m[1].replace(/\./g, '') + (m[2] ? '-' + m[2].toUpperCase() : '');
        const destino = `#/${meta.id}/${encodeURIComponent(art)}${this.q ? '?q=' + encodeURIComponent(this.q) : ''}`;
        if (location.hash === destino) this.irParaArtigo(art);
        else location.hash = destino;
      } else {
        location.hash = `#/${meta.id}?q=${encodeURIComponent(v)}`;
      }
    });

    const texto = $('#texto-lei');
    const acionar = (e) => {
      const n = e.target.closest('.artnum');
      if (n) this.acoesArtigo(this.lei.unidades[Number(n.dataset.u)]);
    };
    texto.addEventListener('click', acionar);
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(e); } });
    $('#topo-pagina').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('#aviso-artigo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-u]');
      if (b) this.destacar(this.lei.unidades[Number(b.dataset.u)]);
    });
    $('#resumo-leitor').addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      if (b.dataset.nav === 'lista') this.listaAchados();
      else this.irParaAchado(this.posicao + Number(b.dataset.nav));
    });
  },

  renderizar({ manterPosicao = false } = {}) {
    const ancora = manterPosicao ? this.unidadeVisivel() : null;
    const termos = this.termos;
    const html = [];
    for (const u of this.lei.unidades) {
      if (u.tipo === 'h') {
        html.push(`<div class="unidade" id="u${u.i}">${u.blocos.map((b) => `<div class="titulo-lei${b.s ? ' rev rev-bloco' : ''}">${htmlDoBloco(b, termos, u.i)}</div>`).join('')}</div>`);
        continue;
      }
      html.push(`<div class="unidade${u.todaTachada ? ' toda-revogada' : ''}" id="u${u.i}">${u.blocos.map((b) => {
        const cls = [b.c ? 'citacao' : classeDoBloco(b.t), b.s ? 'rev rev-bloco' : ''].filter(Boolean).join(' ');
        return `<p${cls ? ` class="${cls}"` : ''}>${htmlDoBloco(b, termos, u.i)}</p>`;
      }).join('')}</div>`);
    }
    const texto = $('#texto-lei');
    texto.innerHTML = html.join('');
    texto.classList.toggle('esconder-revogados', !prefs.revogados);

    this.achados = termos ? buscarNaLei(this.lei, termos) : [];
    this.posicao = -1;
    this.atualizarResumo();
    if (ancora) rolarPara(document.getElementById('u' + ancora));
  },

  unidadeVisivel() {
    const y = ($('.topo')?.offsetHeight || 0) + ($('.barra-leitor')?.offsetHeight || 0) + 12;
    const el = document.elementFromPoint(window.innerWidth / 2, y)?.closest('.unidade');
    return el ? el.id.slice(1) : null;
  },

  atualizarResumo() {
    const r = $('#resumo-leitor');
    if (!this.termos) { r.hidden = true; return; }
    r.hidden = false;
    const n = this.achados.length;
    r.innerHTML = n
      ? `<span>${this.posicao >= 0 ? `${this.posicao + 1} de ` : ''}${n} dispositivo${n > 1 ? 's' : ''} com “${esc(this.q)}”</span>
         <span class="nav"><button class="botao" data-nav="lista">Lista</button><button class="botao" data-nav="-1" aria-label="Anterior">‹</button><button class="botao" data-nav="1" aria-label="Próximo">›</button></span>`
      : `<span>Nenhum resultado para “${esc(this.q)}” nesta lei${prefs.revogados ? '' : ' (texto revogado oculto)'}.</span>`;
    $('#limpar-leitor').hidden = false;
  },

  irParaAchado(i) {
    if (!this.achados.length) return;
    this.posicao = (i + this.achados.length) % this.achados.length;
    this.destacar(this.achados[this.posicao]);
    this.atualizarResumo();
  },

  listaAchados() {
    abrirPainel(`${this.achados.length} resultados`, `<div class="resultados">${this.achados.map((u, i) => `<button class="resultado" data-i="${i}">
      ${u.ctx ? `<div class="ctx">${esc(u.ctx)}</div>` : ''}<div class="trecho">${u.tipo === 'a' ? `<b>Art. ${esc(u.art)}</b> · ` : ''}${trechoDaUnidade(u, this.termos)}</div></button>`).join('')}</div>`, (corpo) => {
      corpo.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        fecharPainel();
        this.irParaAchado(Number(b.dataset.i));
      });
    });
  },

  irParaArtigo(art, uForcada, parte) {
    const lista = this.lei.porArtigo.get(art) || this.lei.porArtigo.get(art.toUpperCase());
    this.avisoArtigo(null);
    if (!lista) { avisar(`Art. ${art} não encontrado nesta lei`); return; }
    if (uForcada !== undefined && this.lei.unidades[uForcada]) {
      this.destacar(this.lei.unidades[uForcada]);
      this.avisoOutras(art, this.lei.unidades[uForcada]);
      return;
    }
    let candidatos = lista.filter((u) => !u.todaTachada);
    if (!candidatos.length) candidatos = lista;
    // Ex.: CLT — "Art. 1º Fica aprovada a Consolidação…" (decreto-lei, antes de
    // qualquer título) não deve competir com o art. 1º da própria CLT.
    if (candidatos.some((u) => u.ctx)) candidatos = candidatos.filter((u) => u.ctx);
    // Partes com numeração própria (ADCT): só entram quando pedidas.
    const naParte = (u) => parte && normalizar(u.ctx || '').includes(normalizar(parte.contexto));
    const emParteSeparada = (u) => (this.lei.meta.partes || []).some((p) => normalizar(u.ctx || '').includes(normalizar(p.contexto)));
    if (parte) {
      const daParte = candidatos.filter(naParte);
      if (daParte.length) candidatos = daParte;
    } else if (candidatos.some((u) => !emParteSeparada(u))) {
      candidatos = candidatos.filter((u) => !emParteSeparada(u));
    }
    const escolhido = melhorVersao(candidatos);
    this.destacar(escolhido);
    this.avisoOutras(art, escolhido);
  },

  // Aviso fixo na barra quando o número aparece mais de uma vez sem estar
  // riscado: outras versões mantidas pelo Planalto ou o mesmo número no ADCT.
  avisoOutras(art, escolhido) {
    const outras = (this.lei.porArtigo.get(art) || []).filter((u) => u !== escolhido && (!u.todaTachada || prefs.revogados) && u.ctx !== undefined);
    const versoes = outras.filter((u) => u.ctx === escolhido.ctx && u.ctx);
    const partes = outras.filter((u) => u.ctx !== escolhido.ctx && u.ctx);
    if (!versoes.length && !partes.length) return;
    const botoes = [
      ...versoes.map((u, k) => `<button class="botao" data-u="${u.i}">Outra versão${versoes.length > 1 ? ' ' + (k + 1) : ''}</button>`),
      ...partes.map((u) => `<button class="botao" data-u="${u.i}">${esc(rotuloParte(this.lei, u))}</button>`),
    ];
    const texto = versoes.length
      ? `O art. ${esc(art)} aparece em ${versoes.length + 1} versões não riscadas no Planalto. Mostrando a de redação mais recente — confira as notas.`
      : `Também existe art. ${esc(art)} em outra parte do texto.`;
    this.avisoArtigo(`<span>${texto}</span><span class="nav">${botoes.join('')}</span>`);
  },

  avisoArtigo(html) {
    const el = $('#aviso-artigo');
    if (!el) return;
    el.hidden = !html;
    el.innerHTML = html || '';
  },

  destacar(u) {
    if (u.todaTachada && !prefs.revogados) {
      salvarPref('revogados', true);
      this.renderizar();
    }
    const el = document.getElementById('u' + u.i);
    if (!el) return;
    document.querySelectorAll('.unidade.alvo').forEach((x) => x.classList.remove('alvo'));
    el.classList.add('alvo');
    rolarPara(el);
  },

  acoesArtigo(u) {
    const meta = this.lei.meta;
    const rotulo = rotuloArtigo(this.lei, u);
    const link = `${location.origin}${location.pathname}#/${meta.id}/${encodeURIComponent(u.art)}`;
    const fav = ehFavorito(meta.id, u.art);
    const texto = () => u.blocos.filter((b) => prefs.revogados || !b.s).map((b) => textoLimpo(b, prefs.revogados)).filter(Boolean).join('\n');
    const hoje = new Date().toLocaleDateString('pt-BR');
    const ancoraPlanalto = `${meta.url}#art${u.art.replace(/-/g, '').toLowerCase()}`;
    abrirPainel(rotulo, `<div class="acoes">
      <button class="botao" data-a="copiar">📋 Copiar texto do artigo</button>
      <button class="botao" data-a="citar">⚖️ Copiar com citação</button>
      <button class="botao" data-a="link">🔗 Copiar link deste artigo</button>
      ${navigator.share ? '<button class="botao" data-a="compartilhar">📤 Compartilhar</button>' : ''}
      <button class="botao" data-a="fav">${fav ? '★ Remover dos favoritos' : '☆ Adicionar aos favoritos'}</button>
      <a class="botao" href="${esc(ancoraPlanalto)}" target="_blank" rel="noopener">↗ Conferir no site do Planalto</a>
    </div>`, (corpo) => {
      corpo.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'copiar') copiar(texto(), 'Texto copiado');
        if (a === 'citar') copiar(`${texto()}\n\n(${meta.nome.replace(/ — /, ', ')}, art. ${u.art}. Disponível em: ${meta.url}. Acesso em: ${hoje}.)`, 'Copiado com citação');
        if (a === 'link') copiar(link, 'Link copiado');
        if (a === 'compartilhar') { try { await navigator.share({ title: rotulo, text: texto().slice(0, 1500), url: link }); } catch { /* cancelado */ } }
        if (a === 'fav') { alternarFavorito(meta.id, u.art); avisar(fav ? 'Removido dos favoritos' : 'Adicionado aos favoritos'); }
        if (a !== 'compartilhar') fecharPainel();
      });
    });
  },

  indice() {
    let titulos = this.lei.unidades.filter((u) => u.tipo === 'h' && !u.blocos.every((b) => b.s));
    // Só divisões reais (Livro, Título, Capítulo, Seção…); sem "Vigência", assinaturas etc.
    if (titulos.some((u) => u.nivel)) titulos = titulos.filter((u) => u.nivel);
    if (!titulos.length) { avisar('Esta lei não tem divisões'); return; }
    abrirPainel('Índice', `<nav class="indice">${titulos.map((u) => {
      const vis = u.blocos.filter((b) => !b.s);
      return `<a href="#" data-u="${u.i}" class="n${u.nivel || 4}">${esc(vis.map((b) => b.t).join(' — '))}</a>`;
    }).join('')}</nav>`, (corpo) => {
      corpo.addEventListener('click', (e) => {
        const a = e.target.closest('[data-u]');
        if (!a) return;
        e.preventDefault();
        fecharPainel();
        rolarPara(document.getElementById('u' + a.dataset.u));
      });
    });
  },
};
$('#btn-indice').addEventListener('click', () => leitor.indice());

window.addEventListener('scroll', () => {
  const b = $('#topo-pagina');
  if (b) b.hidden = window.scrollY < 1200;
}, { passive: true });

function telaIndisponivel(e, id, art) {
  const meta = e.meta || catalogo.porId.get(id);
  configurarTopo({ titulo: meta?.sigla || 'Lei', voltar: true });
  app.innerHTML = `<div class="vazio">
    <strong>${meta ? 'O texto desta lei ainda não está disponível aqui' : 'Lei não encontrada'}</strong>
    ${meta ? `<p>O download automático do Planalto ainda não foi feito ou falhou. Você pode consultar diretamente a fonte oficial:</p>
    <p><a class="botao primario" href="${esc(meta.url)}${art ? '#art' + esc(art.replace(/-/g, '').toLowerCase()) : ''}" target="_blank" rel="noopener">Abrir ${esc(meta.sigla)} no Planalto ↗</a></p>` : ''}
    <p><a href="#/">Voltar ao início</a></p></div>`;
}

// ---------- Roteamento ----------
async function rotear() {
  navegacoes++;
  await carregarCatalogo();
  if (!$('#painel').hidden) fecharPainel();
  const h = location.hash.replace(/^#\/?/, '');
  const i = h.indexOf('?');
  const caminho = i === -1 ? h : h.slice(0, i);
  const params = new URLSearchParams(i === -1 ? '' : h.slice(i + 1));
  const partes = caminho.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (!partes.length) return telaInicio();
  if (partes[0] === 'busca') return telaBuscaGlobal(params.get('q') || '');
  const u = params.get('u');
  return leitor.abrir(partes[0], partes[1] || null, params.get('q') || '', u !== null ? Number(u) : undefined, params.get('parte'));
}
window.addEventListener('hashchange', rotear);
rotear().catch((e) => {
  console.error(e);
  app.innerHTML = '<div class="vazio"><strong>Não foi possível carregar o aplicativo</strong>Verifique sua conexão e recarregue a página.</div>';
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
