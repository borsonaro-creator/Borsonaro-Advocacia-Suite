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
  let citacao = 0; // profundidade de <blockquote>
  const blocos = [];
  let atual = [];
  let citacaoDoBloco = 0;

  const fechaBloco = () => {
    if (atual.length) blocos.push({ segs: atual, bq: citacaoDoBloco });
    atual = [];
  };
  const riscadoAgora = () => pilha.some((e) => e.riscado);

  let m;
  while ((m = re.exec(html))) {
    const [, barra, nomeBruto, attrs, texto] = m;
    if (texto !== undefined || (!nomeBruto && m[0] === '<')) {
      if (ignorando) continue;
      const t = decodificarEntidades(texto ?? '<');
      if (t) {
        if (!atual.length) citacaoDoBloco = citacao;
        atual.push([t, riscadoAgora()]);
      }
      continue;
    }
    const nome = nomeBruto.toLowerCase();
    if (IGNORAR_CONTEUDO.has(nome)) {
      if (!barra) ignorando++;
      else ignorando = Math.max(0, ignorando - 1);
      continue;
    }
    if (ignorando) continue;
    if (BLOCO.has(nome) || nome === 'blockquote') fechaBloco();
    if (nome === 'blockquote') citacao = Math.max(0, citacao + (barra ? -1 : 1));
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
  // Normaliza espaços considerando o bloco inteiro: vários trechos seguidos só
  // de espaço viram um espaço só (e somem no início/fim do bloco).
  const lista = [];
  let terminaEmEspaco = true;
  for (const [t0, r] of segs) {
    let t = normalizarEspacos(t0);
    if (terminaEmEspaco) t = t.replace(/^ /, '');
    if (!t) continue;
    terminaEmEspaco = t.endsWith(' ');
    lista.push([t, r]);
  }
  while (lista.length) {
    const u = lista[lista.length - 1];
    u[0] = u[0].replace(/ $/, '');
    if (u[0]) break;
    lista.pop();
  }
  // Espaços soltos (ex.: <strike> que só contém uma âncora) não decidem se o
  // trecho está tachado: herdam a marcação do texto seguinte ou anterior.
  for (let i = 0; i < lista.length; i++) {
    if (lista[i][0].trim()) continue;
    const viz = lista.slice(i + 1).find((x) => x[0].trim()) || lista.slice(0, i).reverse().find((x) => x[0].trim());
    if (viz) lista[i][1] = viz[1];
  }
  const unidos = [];
  for (const [t, r] of lista) {
    const ult = unidos[unidos.length - 1];
    if (ult && ult[1] === r) ult[0] += t;
    else unidos.push([t, r]);
  }
  // "§ 1 o Para…" / "Art. 5 o" (o ordinal vem em <sup> separado) → "§ 1º Para…"
  if (unidos.length) unidos[0][0] = unidos[0][0].replace(/^((?:Art(?:igo)?s?\.?|§)\s*\d{1,2}(?:\.\d{3})*|(?:Art(?:igo)?s?\.?|§)\s*\d{1,4})\s?o(?=[\s.\-–]|$)/, '$1º');
  return unidos;
}

const RE_ARTIGO = /^Art(?:igo)?s?\.?\s*(\d{1,2}(?:\.\d{3})+|\d{1,4})(?:([A-Z]{1,2})(?![A-Za-zÀ-ú]))?\s*(?:\.?\s*[º°o](?![a-zà-ú]))?(?:\s*-([A-Z]{1,2})(?![A-Za-zÀ-ú]))?/;
const RE_TITULO = /^(PARTE (GERAL|ESPECIAL)|PARTE\s+[IVXLC]+\b|LIVRO\b|LIVRO COMPLEMENTAR|T[ÍI]TULO\b|CAP[ÍI]TULO\b|SE[ÇC][ÃA]O\b|SUBSE[ÇC][ÃA]O\b|Se[çc][ãa]o\s+[IVXLC]+|Subse[çc][ãa]o\s+[IVXLC]+|ATO DAS DISPOSI[ÇC][ÕO]ES|DISPOSI[ÇC][ÕO]ES (GERAIS|FINAIS|TRANSIT[ÓO]RIAS|PRELIMINARES)|PRE[ÂA]MBULO)/;
const BOILERPLATE = /^(Presid[êe]ncia da Rep[úu]blica|Casa Civil|Secretaria[- ]Geral|Subchefia para Assuntos Jur[íi]dicos|Secretaria Especial para Assuntos Jur[íi]dicos)$/i;

const RE_INTERVALO = /^Art(?:igo)?s?\.?\s*(\d{1,2}(?:\.\d{3})+|\d{1,4})\s*[º°o]?\.?\s*(?:a|até)\s+(?:o\s+)?(\d{1,2}(?:\.\d{3})+|\d{1,4})\b/;

// "Art. 1.620. a 1.629. (Revogados…)" → [1620, 1629]
export function intervaloArtigos(texto) {
  const m = RE_INTERVALO.exec(texto);
  if (!m) return null;
  const [a, b] = [Number(m[1].replace(/\./g, '')), Number(m[2].replace(/\./g, ''))];
  return b > a && b - a <= 200 ? [a, b] : null;
}

export function numeroArtigo(texto) {
  const m = RE_ARTIGO.exec(texto);
  if (!m) return null;
  const num = m[1].replace(/\./g, '');
  const letra = m[2] || m[3]; // "Art. 22A" ou "Art. 22-A"
  return letra ? `${num}-${letra.toUpperCase()}` : num;
}

function pareceTituloEmCaixaAlta(t) {
  if (t.length > 160 || t.length < 4) return false;
  if (/^(§|Art|PAR[ÁA]GRAFO|\()/i.test(t) || /:$/.test(t)) return false;
  if (/[a-zà-ú]/.test(t)) return false;
  if (!/[A-ZÀ-Ú]{3}/.test(t)) return false;
  if (/^[IVXLC]+\s*[-–—]/.test(t)) return false; // inciso em maiúsculas
  return true;
}

function pareceSubtitulo(t) {
  return t.length <= 140 && !/[.;:,]$/.test(t) && !/^(Art|§|Par[áa]grafo|[IVXLC]+\s*[-–—]|[a-z]\))/.test(t) && !/^\(/.test(t);
}

// Nas versões superadas (ex.: MP que caducou) o Planalto risca o texto, mas
// deixa sem risco as notas "(Redação dada pela MP…) Vigência encerrada".
// Se tudo o que sobra sem risco são notas, o bloco conta como riscado.
export function soSobramNotas(segs) {
  if (!segs.some((x) => x[1])) return false;
  const letras = (t) => (t.match(/[A-Za-zÀ-ú0-9]/g) || []).length;
  const riscado = letras(segs.filter((x) => x[1]).map((x) => x[0]).join(''));
  const total = letras(segs.map((x) => x[0]).join(''));
  const livre = segs.filter((x) => !x[1]).map((x) => x[0]).join(' ')
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, ' ')
    .replace(/\b(Vig[êe]ncia encerrada|Vig[êe]ncia|Produ[çc][ãa]o de efeitos?|Convers[ãa]o|Regulamento|Mensagem de veto)\b/gi, ' ')
    .replace(/[\s.,;:()–—-]+/g, '');
  // Sobra no máximo uma letra solta (ex.: o "A" de "Art." fora do <strike>),
  // ou quase tudo está riscado e o resto é curto (ex.: só "gratuita." de fora).
  return livre.length <= 2 || (riscado / total >= 0.8 && livre.length <= 30);
}

export function parsePlanalto(html) {
  const titulo = normalizarEspacos(decodificarEntidades((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '')).trim();
  const brutos = extrairBlocosBrutos(html);
  const blocos = [];
  let anteriorEraTitulo = false;

  // Citações: textos de outras leis transcritos (alterações), entre aspas ou
  // dentro de <blockquote>. Seus "Art." não são artigos desta lei.
  let emCitacao = false;
  let citacaoNoBq = false;
  let blocosNaCitacao = 0;
  let ultimoArtigo = 0;
  const RE_FECHA_ASPAS = /[”"]\s*(?:\(\s*NR\s*\))?\s*[.;,]?\s*(?:\((?:[^()]|\([^()]*\))*\)\s*)*$/;

  let rodape = false; // depois de "Este texto não substitui o publicado no DOU"

  for (const { segs: segsBrutos, bq } of brutos) {
    if (emCitacao && citacaoNoBq && !bq) emCitacao = false;
    const segs = consolidarSegmentos(segsBrutos);
    if (!segs.length) continue;
    const t = segs.map((s) => s[0]).join('');
    if (!t.trim() || BOILERPLATE.test(t)) continue;

    const bloco = { k: 'p', t };
    const tachados = segs.filter((s) => s[1]);
    if (tachados.length === segs.length || soSobramNotas(segs)) bloco.s = 1;
    else if (tachados.length) bloco.g = segs.map(([x, r]) => [x, r ? 1 : 0]);

    // Notas do Planalto depois do aviso "Este texto não substitui…": não são
    // artigos da lei. O aviso também aparece no meio da página (CF antes do
    // ADCT; CLT e Decreto 3.048 depois do decreto de aprovação), então uma
    // divisão real (Título, Livro, ADCT…) volta ao texto normal.
    if (rodape && RE_TITULO.test(t) && !/^\d/.test(t)) rodape = false;
    if (rodape || /^Este texto n[ãa]o substitui/i.test(t)) {
      rodape = true;
      bloco.c = 1;
      blocos.push(bloco);
      continue;
    }

    const abreAspas = /^[“"]/.test(t);
    let citado = emCitacao || abreAspas;
    let art = numeroArtigo(t);
    // Rede de segurança: aspas não fechadas não podem engolir a lei. Um artigo
    // sem aspas que continua a numeração desta lei encerra a citação.
    if (citado && !abreAspas && art && !bq && (Number(art.split('-')[0]) === ultimoArtigo + 1 || blocosNaCitacao > 150)) {
      citado = false;
      emCitacao = false;
    }
    if (citado) {
      bloco.c = 1;
      if (!emCitacao) { emCitacao = true; citacaoNoBq = bq > 0; blocosNaCitacao = 0; }
      blocosNaCitacao++;
      if (RE_FECHA_ASPAS.test(t) && !(abreAspas && t.length < 3)) emCitacao = false;
      anteriorEraTitulo = false;
      blocos.push(bloco);
      continue;
    }
    if (art) {
      const n = Number(art.split('-')[0]);
      if (!art.includes('-') && n > ultimoArtigo) ultimoArtigo = n;
      const intervalo = intervaloArtigos(t);
      if (intervalo) {
        bloco.ate = intervalo[1];
        ultimoArtigo = Math.max(ultimoArtigo, intervalo[1]);
      }
      bloco.k = 'a';
      bloco.a = art;
      anteriorEraTitulo = false;
    } else if (RE_TITULO.test(t)) {
      bloco.k = 'h';
      anteriorEraTitulo = true;
    } else if (pareceTituloEmCaixaAlta(t)) {
      bloco.k = 'h';
      anteriorEraTitulo = false;
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
