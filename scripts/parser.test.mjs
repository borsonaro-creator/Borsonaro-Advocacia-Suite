import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePlanalto, decodificarBytes, numeroArtigo } from './parser.mjs';

const bytes = await readFile(new URL('./fixtures/planalto-exemplo.htm', import.meta.url));
const { titulo, blocos } = parsePlanalto(decodificarBytes(bytes));
const textos = blocos.map((b) => b.t);
const artigos = blocos.filter((b) => b.k === 'a');

test('decodifica windows-1252 e entidades', () => {
  assert.equal(titulo, 'Del5452compilado');
  assert.ok(textos.includes('DECRETO-LEI Nº 5.452, DE 1º DE MAIO DE 1943'));
  assert.ok(textos.includes('Aprova a Consolidação das Leis do Trabalho.'));
  assert.ok(textos.some((t) => t.includes('milhar–com')));
  assert.ok(textos.includes('Art. 477 – A extinção do “contrato” de trabalho.'), 'bytes 0x93/0x94/0x96');
});

test('remove cabeçalho padrão, comentários e scripts', () => {
  assert.ok(!textos.some((t) => /Presid.ncia|Casa Civil|Subchefia/.test(t)));
  assert.ok(!textos.some((t) => /999|998/.test(t)));
});

test('identifica artigos e normaliza números', () => {
  assert.deepEqual(artigos.map((b) => b.a), ['1', '2', '10', '10-A', '11', '11', '1000', '477', '500', '501']);
  assert.equal(numeroArtigo('Art. 10 - A empresa'), '10');
  assert.equal(numeroArtigo('Art. 2o-B. Texto'), '2-B');
  assert.equal(numeroArtigo('Art. 5º Todos são iguais'), '5');
  assert.equal(numeroArtigo('Artigo 3'), '3');
  assert.equal(numeroArtigo('Arte'), null);
  assert.equal(numeroArtigo('Art. 22A. A contribuição devida pela agroindústria'), '22-A');
  assert.equal(numeroArtigo('Art. 9º-C. As aplicações'), '9-C');
  assert.equal(numeroArtigo('Art. 10 - A empresa'), '10');
  assert.equal(numeroArtigo('Art 1º Nos processos'), '1');
});

test('marca texto tachado inteiro e parcial', () => {
  const p2 = blocos.filter((b) => b.t.startsWith('§ 2'));
  assert.equal(p2[0].s, 1);
  assert.equal(p2[1].s, undefined);
  assert.equal(p2[1].t.includes('§ 2º Sempre'), true);
  const art11 = artigos.filter((b) => b.a === '11');
  assert.equal(art11[0].s, 1, 'span com line-through');
  assert.equal(art11[1].s, undefined);
  assert.deepEqual(art11[1].g.filter((g) => g[1]).map((g) => g[0]), ['dois']);
  const art500 = blocos.findIndex((b) => b.a === '500');
  assert.equal(blocos[art500].s, 1);
  assert.equal(blocos[art500 + 1].s, 1, '<strike> abrangendo vários <p>');
  assert.equal(blocos.find((b) => b.a === '501').s, undefined);
});

test('classifica títulos e subtítulos', () => {
  const titulos = blocos.filter((b) => b.k === 'h').map((b) => b.t);
  for (const t of ['TÍTULO I', 'INTRODUÇÃO', 'CAPÍTULO II', 'Seção I', 'Das Disposições Gerais']) {
    assert.ok(titulos.includes(t), t);
  }
  const inciso = blocos.find((b) => b.t.startsWith('I - '));
  assert.equal(inciso.k, 'p');
});

// Trechos reais do Planalto que já causaram erros de conversão.
const reais = parsePlanalto(decodificarBytes(await readFile(new URL('./fixtures/planalto-trechos-reais.htm', import.meta.url)))).blocos;
const reaisArtigos = reais.filter((b) => b.k === 'a');

test('reconhece artigo precedido de <strike> vazio com âncora', () => {
  const b = reais.find((x) => x.t.includes('75-B'));
  assert.equal(b.t, 'Art. 75-B. Considera-se teletrabalho.');
  assert.equal(b.k, 'a');
  assert.equal(b.a, '75-B');
  assert.equal(b.s, undefined);
  assert.equal(b.g, undefined);
});

test('junta ordinal em <sup> e espaços entre trechos', () => {
  assert.ok(reais.some((b) => b.t === '§ 1º Para a concessão da tutela.'));
});

test('intervalo de artigos revogados', () => {
  const b = reais.find((x) => x.a === '1620');
  assert.equal(b.ate, 1629);
});

test('textos citados (alterações de outras leis) não viram artigos', () => {
  assert.deepEqual(reaisArtigos.map((b) => b.a), ['75-B', '1620', '1630', '1631', '1632', '1633', '1634']);
  for (const t of ['“CAPÍTULO III', 'Da Tomada de Decisão Apoiada', 'Art. 1.783-A. A tomada de decisão apoiada é o processo.', '"Art. 15. Decorridos sessenta dias do trânsito em julgado.', 'Art. 16. Linha citada sem aspas que continua a citação.']) {
    const b = reais.find((x) => x.t === t);
    assert.ok(b, t);
    assert.equal(b.k, 'p', t);
    assert.equal(b.c, 1, t);
  }
});

test('não trata como título notas de cabeçalho, "DECRETA:" e "§ (VETADO)"', () => {
  const titulos = reais.filter((b) => b.k === 'h').map((b) => b.t);
  assert.deepEqual(titulos, ['LEI Nº 13.105, DE 16 DE MARÇO DE 2015.', 'CAPÍTULO I', 'Disposições Gerais', 'GETÚLIO VARGAS']);
});
