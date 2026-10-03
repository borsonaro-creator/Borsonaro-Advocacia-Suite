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
});

test('marca texto tachado inteiro e parcial', () => {
  const p2 = blocos.filter((b) => b.t.startsWith('§ 2'));
  assert.equal(p2[0].s, 1);
  assert.equal(p2[1].s, undefined);
  assert.equal(p2[1].t.includes('§ 2o Sempre'), true);
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
