// Converte o HTML das páginas de legislação do Planalto em blocos estruturados.
//
// Cada bloco tem o formato:
//   { k: 'h' | 'a' | 'p', t: 'texto', a?: '477-A', s?: 1, g?: [[texto, tachado], ...] }
//   k = 'h' título/capítulo/seção, 'a' início de artigo, 'p' demais textos
//       (parágrafos, incisos, alíneas, ementa, notas)
//   a = número do artigo normalizado (só quando k = 'a')
//   s = 1 quando o bloco inteiro está tachado (redação revogada/alterada)
//   g = segmentos quando só parte do bloco está tachada

const BLOCO = new Set([
  'p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol',
  'tr', 'td', 'th', 'table', 'tbody', 'thead', 'center', 'blockquote', 'hr',
  'body', 'html', 'dd', 'dt', 'dl', 'pre', 'section', 'article',
]);
const VAZIO = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'area', 'base', 'col', 'wbr']);
const TACHADO = new Set(['strike', 's', 'del']);
const IGNORAR_CONTEUDO = new Set(['script', 'style', 'head', 'title', 'noscript', 'xml']);

const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ordm: 'º', ordf: 'ª', sect: '§', deg: '°', middot: '·', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  bull: '•', para: '¶', copy: '©', reg: '®', shy: '',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', auml: 'ä', Auml: 'Ä',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê', euml: 'ë', Euml: 'Ë',
  iacute: 'í', Iacute: 'Í', igrave: 'ì', Igrave: 'Ì', icirc: 'î', Icirc: 'Î', iuml: 'ï', Iuml: 'Ï',
  oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', ouml: 'ö', Ouml: 'Ö',
  uacute: 'ú', Uacute: 'Ú', ugrave: 'ù', Ugrave: 'Ù', ucirc: 'û', Ucirc: 'Û', uuml: 'ü', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ',
};

// Tabela windows-1252 para 0x80–0x9F (o TextDecoder do Node trata essa faixa
// como latin1 e perderia travessões e aspas curvas, muito usados no Planalto).
const CP1252_80_9F = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

export function decodificarCp1252(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) {
    const parte = u8.subarray(i, i + 8192);
    s += String.fromCharCode.apply(null, Array.from(parte, (b) => (b >= 0x80 && b <= 0x9f ? CP1252_80_9F.charCodeAt(b - 0x80) : b)));
  }
  return s;
}

export function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (orig, nome) => {
    if (nome[0] === '#') {
      const cod = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      if (!Number.isFinite(cod) || cod <= 0) return orig;
      // Páginas antigas usam referências numéricas no intervalo windows-1252.
      if (cod >= 0x80 && cod <= 0x9f) return CP1252_80_9F[cod - 0x80];
      return String.fromCodePoint(cod);
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES, nome) ? ENTIDADES[nome] : orig;
  });
}

// Decodifica os bytes da página respeitando o charset declarado (o Planalto usa
// majoritariamente windows-1252, mas algumas páginas novas estão em UTF-8).
export function decodificarBytes(bytes, contentType = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const cabecalho = new TextDecoder('latin1').decode(u8.subarray(0, 4096));
  const declarado = (/charset=["']?([\w-]+)/i.exec(contentType) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(cabecalho) || [])[1];
  if (declarado && /utf-?8/i.test(declarado)) return new TextDecoder('utf-8').decode(u8);
  if (!declarado) {
    const tentativa = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    if (!tentativa.includes('�')) return tentativa;
  }
  return decodificarCp1252(u8);
}

function atributoRiscado(attrs) {
  return /line-through/i.test(attrs);
}

function removerUltimo(pilha, nome) {
  for (let i = pilha.length - 1; i >= 0; i--) {
    if (pilha[i].nome === nome) {
      pilha.splice(i, 1);
      return;
    }
  }
}

// Percorre o HTML e devolve uma lista de blocos de texto, cada um como lista de
// segmentos [texto, tachado].
function extrairBlocosBrutos(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</g;
  const pilha = []; // { nome, riscado }
  let ignorando = 0;
  const blocos = [];
  let atual = [];

  const fechaBloco = () => {
    if (atual.length) blocos.push(atual);
    atual = [];
  };
  const riscadoAgora = () => pilha.some((e) => e.riscado);

  let m;
  while ((m = re.exec(html))) {
    const [, barra, nomeBruto, attrs, texto] = m;
    if (texto !== undefined || (!nomeBruto && m[0] === '<')) {
      if (ignorando) continue;
      const t = decodificarEntidades(texto ?? '<');
      if (t) atual.push([t, riscadoAgora()]);
      continue;
    }
    const nome = nomeBruto.toLowerCase();
    if (IGNORAR_CONTEUDO.has(nome)) {
      if (!barra) ignorando++;
      else ignorando = Math.max(0, ignorando - 1);
      continue;
    }
    if (ignorando) continue;
    if (BLOCO.has(nome)) fechaBloco();
    if (VAZIO.has(nome) || attrs.trim().endsWith('/')) continue;

    if (!barra) {
      // <p> não fechado: um novo <p> fecha implicitamente o anterior.
      if (nome === 'p') removerUltimo(pilha, 'p');
      pilha.push({ nome, riscado: TACHADO.has(nome) || atributoRiscado(attrs) });
    } else {
      // Como os navegadores, fechar uma tag não encerra as de formatação abertas
      // dentro dela: <p><strike>a</p><p>b</p> deixa "b" tachado também.
      removerUltimo(pilha, nome);
    }
  }
  fechaBloco();
  return blocos;
}

function normalizarEspacos(t) {
  return t.replace(/[\s ​]+/g, ' ');
}

function consolidarSegmentos(segs) {
  const saida = [];
  for (const [t0, r] of segs) {
    const t = normalizarEspacos(t0);
    if (!t) continue;
    const ult = saida[saida.length - 1];
    if (ult && ult[1] === r) ult[0] += t;
    else saida.push([t, r]);
  }
  // Espaços soltos não decidem se o trecho está tachado.
  for (let i = 0; i < saida.length; i++) {
    if (!saida[i][0].trim()) {
      const viz = saida[i - 1] || saida[i + 1];
      if (viz) saida[i][1] = viz[1];
    }
  }
  const unidos = [];
  for (const s of saida) {
    const ult = unidos[unidos.length - 1];
    if (ult && ult[1] === s[1]) ult[0] += s[0];
    else unidos.push([...s]);
  }
  if (unidos.length) {
    unidos[0][0] = unidos[0][0].replace(/^\s+/, '');
    unidos[unidos.length - 1][0] = unidos[unidos.length - 1][0].replace(/\s+$/, '');
  }
  return unidos.filter((s) => s[0]);
}

const RE_ARTIGO = /^Art(?:igo)?\.?\s*(\d{1,2}(?:\.\d{3})+|\d{1,4})\s*(?:\.?\s*[º°o](?![a-zà-ú]))?\s*(?:-([A-Z]{1,2})(?![A-Za-zÀ-ú]))?/;
const RE_TITULO = /^(PARTE (GERAL|ESPECIAL)|PARTE\s+[IVXLC]+\b|LIVRO\b|LIVRO COMPLEMENTAR|T[ÍI]TULO\b|CAP[ÍI]TULO\b|SE[ÇC][ÃA]O\b|SUBSE[ÇC][ÃA]O\b|Se[çc][ãa]o\s+[IVXLC]+|Subse[çc][ãa]o\s+[IVXLC]+|ATO DAS DISPOSI[ÇC][ÕO]ES|DISPOSI[ÇC][ÕO]ES (GERAIS|FINAIS|TRANSIT[ÓO]RIAS|PRELIMINARES)|PRE[ÂA]MBULO)/;
const BOILERPLATE = /^(Presid[êe]ncia da Rep[úu]blica|Casa Civil|Secretaria[- ]Geral|Subchefia para Assuntos Jur[íi]dicos|Secretaria Especial para Assuntos Jur[íi]dicos)$/i;

export function numeroArtigo(texto) {
  const m = RE_ARTIGO.exec(texto);
  if (!m) return null;
  const num = m[1].replace(/\./g, '');
  return m[2] ? `${num}-${m[2].toUpperCase()}` : num;
}

function pareceTituloEmCaixaAlta(t) {
  if (t.length > 160 || t.length < 4) return false;
  if (/[a-zà-ú]/.test(t)) return false;
  if (!/[A-ZÀ-Ú]{3}/.test(t)) return false;
  if (/^[IVXLC]+\s*[-–—]/.test(t)) return false; // inciso em maiúsculas
  return true;
}

function pareceSubtitulo(t) {
  return t.length <= 140 && !/[.;:,]$/.test(t) && !/^(Art|§|Par[áa]grafo|[IVXLC]+\s*[-–—]|[a-z]\))/.test(t) && !/^\(/.test(t);
}

export function parsePlanalto(html) {
  const titulo = normalizarEspacos(decodificarEntidades((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '')).trim();
  const brutos = extrairBlocosBrutos(html);
  const blocos = [];
  let anteriorEraTitulo = false;

  for (const segsBrutos of brutos) {
    const segs = consolidarSegmentos(segsBrutos);
    if (!segs.length) continue;
    const t = segs.map((s) => s[0]).join('');
    if (!t.trim() || BOILERPLATE.test(t)) continue;

    const bloco = { k: 'p', t };
    const tachados = segs.filter((s) => s[1]);
    if (tachados.length === segs.length) bloco.s = 1;
    else if (tachados.length) bloco.g = segs.map(([x, r]) => [x, r ? 1 : 0]);

    const art = numeroArtigo(t);
    if (art) {
      bloco.k = 'a';
      bloco.a = art;
      anteriorEraTitulo = false;
    } else if (RE_TITULO.test(t) || pareceTituloEmCaixaAlta(t)) {
      bloco.k = 'h';
      anteriorEraTitulo = true;
    } else if (anteriorEraTitulo && pareceSubtitulo(t)) {
      // Ex.: "Seção I" seguido de "Das Disposições Gerais".
      bloco.k = 'h';
      anteriorEraTitulo = false;
    } else {
      anteriorEraTitulo = false;
    }
    blocos.push(bloco);
  }
  return { titulo, blocos };
}
