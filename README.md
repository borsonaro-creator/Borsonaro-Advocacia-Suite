# Legislação — consulta rápida

Site leve para ler e pesquisar a legislação federal do **site oficial do Planalto**,
pensado para uso diário no escritório: funciona no navegador do celular e do computador,
sem instalar nada.

## O que ele faz

- **Ir direto ao artigo**: digite `CLT 477`, `CC 186`, `CPC art. 300`, `8213 art 42`,
  `LOAS 20`, `CF 7`, `ADCT 10`, `CLT 10-A`… e o artigo abre destacado.
- **Buscar por texto**: digite qualquer termo (`férias proporcionais`, `"dano moral"` entre
  aspas para expressão exata) para buscar em todas as leis, ou só na lei aberta.
- **Leitura confortável**: tamanho de letra ajustável, fonte com ou sem serifa, tema claro/escuro.
- **Texto revogado**: por padrão mostra só a redação vigente; uma opção exibe as redações
  antigas tachadas, como no Planalto. As notas “(Redação dada pela…)”, “(Incluído pela…)”
  aparecem em letra menor.
- **Toque no número do artigo** para: copiar o texto, copiar com citação (com fonte e data de
  acesso), copiar link direto, compartilhar (WhatsApp, e-mail…), favoritar ou conferir no Planalto.
- **Versões repetidas**: quando o Planalto mantém mais de uma redação sem riscar (ex.: textos
  de MPs com vigência encerrada ou suspensa), o app abre a de redação mais recente e avisa,
  com botão para ver as outras. Na CF, o ADCT não se mistura com a parte permanente.
- **Índice** de títulos/capítulos/seções de cada lei.
- **Favoritos e recentes** na tela inicial.
- **Funciona offline** depois que a lei foi aberta uma vez, e pode ser “instalado” na tela
  inicial do celular (opção *Adicionar à tela de início* do navegador), sem loja de aplicativos.

## Leis incluídas

| Área | Leis |
|---|---|
| Constituição | CF/88 |
| Civil e processo civil | Código Civil, CPC, LINDB, CDC, Lei do Inquilinato, Bem de Família, Juizados Especiais (9.099 e 10.259), Estatuto da Pessoa Idosa, Estatuto da Pessoa com Deficiência |
| Trabalho | CLT, FGTS (8.036), Empregado Doméstico (LC 150), Temporário/Terceirização (6.019), DSR (605), 13º salário (4.090), Seguro-desemprego (7.998), Processo do Trabalho (5.584) |
| Previdenciário | Lei 8.213/91, Lei 8.212/91, Decreto 3.048/99, LOAS (8.742), EC 103/2019 |

Para incluir outra lei, acrescente uma entrada em [`leis.json`](leis.json) com o link da página
compilada do Planalto e os apelidos usados na busca.

## Como os textos são atualizados

O navegador não consegue ler o site do Planalto diretamente (bloqueio de segurança entre
sites), então o texto é baixado por um script e guardado em `data/`:

- O GitHub Actions ([`.github/workflows/publicar.yml`](.github/workflows/publicar.yml)) roda
  **toda segunda-feira**, baixa cada lei do Planalto, converte em artigos e publica o site.
  Pode ser executado a qualquer momento em *Actions → Atualizar leis e publicar site → Run workflow*.
- Se uma lei falhar no download, a versão anterior é mantida.
- O workflow **Conferir conversão das leis** ([`.github/workflows/verificar.yml`](.github/workflows/verificar.yml))
  gera um relatório por lei: artigos faltando na numeração, "Art." não reconhecido, números
  vigentes repetidos e amostras de artigos conhecidos. Rode-o depois de mudar o conversor.
- Cada lei mostra a data em que foi verificada no Planalto e um link para a página oficial.

## Colocar no ar (uma vez só)

1. Faça o merge desta branch na `main`.
2. No GitHub: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
   - O GitHub Pages em repositório **privado** exige plano pago (GitHub Pro). Como o conteúdo é
     só legislação pública, uma alternativa é tornar o repositório público; outra é publicar a
     pasta em um serviço gratuito como Cloudflare Pages ou Netlify.
3. Em *Actions*, rode **Atualizar leis e publicar site**. Ao final aparece o endereço do site
   (algo como `https://<usuario>.github.io/<repositorio>/`).
4. Abra o endereço no celular e use *Adicionar à tela de início*.

### Se o Planalto bloquear os servidores do GitHub

Às vezes o Planalto recusa acessos de servidores fora do Brasil. Nesse caso, rode a
atualização em um computador com Node.js 18+:

```bash
node scripts/atualizar-leis.mjs          # todas as leis
node scripts/atualizar-leis.mjs clt cc   # só algumas
```

Ou salve as páginas pelo navegador (*Salvar como → Página da Web, somente HTML*) em
`fontes/<id>.htm` (ex.: `fontes/clt.htm`) e rode `node scripts/atualizar-leis.mjs --local`.
Depois faça commit da pasta `data/`.

## Desenvolvimento

```bash
npm test            # testes do conversor do HTML do Planalto
npm run servir      # site em http://localhost:8080
```

Sem dependências externas: HTML, CSS e JavaScript puros.

---

> Ferramenta de apoio à consulta. Em caso de divergência, prevalece o texto publicado no
> Diário Oficial e no site oficial do Planalto.
