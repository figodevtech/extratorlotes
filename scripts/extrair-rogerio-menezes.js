/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const archiver = require("archiver");

const BASE_URL = "https://www.rogeriomenezes.com.br";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const MAX_PAGINAS = 30;
const DELAY_PAGINA_MS = 500;
const DELAY_LOTE_MS = 700;
const DELAY_IMAGEM_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarUrl(valor) {
  const url = new URL(valor.replace(/\\\//g, "/"), BASE_URL);
  url.hash = "";
  return url.toString();
}

function nomeSeguro(valor) {
  return String(valor).replace(/[\\/:*?"<>|]/g, "-").trim() || "sem-nome";
}

function extensaoImagem(url, contentType) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(webp|jpe?g|png|gif)$/i);
  if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
  if (contentType && contentType.includes("webp")) return ".webp";
  if (contentType && contentType.includes("png")) return ".png";
  if (contentType && contentType.includes("gif")) return ".gif";
  return ".jpg";
}

async function buscarHtml(url) {
  const response = await axios.get(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 30000,
  });
  return response.data;
}

function extrairLinksLotes(html) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /\/lote\/\d+\//.test(href)) {
      links.add(normalizarUrl(href));
    }
  });

  return [...links];
}

function extrairNumeroLote($, fallback) {
  const candidatos = [
    $("h1").first().text(),
    $("h2").first().text(),
    $("[class*=lote], [id*=lote]").first().text(),
    $("body").text().slice(0, 4000),
  ];

  for (const texto of candidatos) {
    const match = texto.match(/lote\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d+)/i);
    if (match && match[1]) return match[1];
  }

  return fallback;
}

function extrairTitulo($) {
  return $("h1").first().text().trim() || $("h2").first().text().trim() || null;
}

function extrairSrcset(valor) {
  return valor
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function pareceImagemDeLote(url) {
  const lower = url.toLowerCase();
  return (
    /\.(webp|jpe?g|png|gif)(\?.*)?$/.test(lower) &&
    /static\.suporteleiloes\.com\.br\/rogeriomenezescombr\/bens\/\d+\/arquivos\//.test(lower)
  );
}

function extrairBemId(url) {
  const match = url.match(/\/bens\/(\d+)\/arquivos\//);
  return match ? match[1] : null;
}

function filtrarBemDominante(urls) {
  const contagem = new Map();
  for (const url of urls) {
    const bemId = extrairBemId(url);
    if (bemId) contagem.set(bemId, (contagem.get(bemId) || 0) + 1);
  }

  const bemDominante = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return bemDominante ? urls.filter((url) => extrairBemId(url) === bemDominante) : urls;
}

function extrairImagens(html) {
  const $ = cheerio.load(html);
  const imagensGaleria = new Set();
  const imagensFallback = new Set();
  const atributos = ["src", "data-src", "data-lazy", "data-original"];

  function adicionar(destino, valor) {
    if (!valor) return;
    const url = normalizarUrl(valor);
    if (pareceImagemDeLote(url)) destino.add(url);
  }

  $("a[href]").each((_, element) => adicionar(imagensGaleria, $(element).attr("href")));

  $("img").each((_, element) => {
    for (const atributo of atributos) adicionar(imagensFallback, $(element).attr(atributo));
    const srcset = $(element).attr("srcset");
    if (srcset) for (const item of extrairSrcset(srcset)) adicionar(imagensFallback, item);
  });

  $("script").each((_, element) => {
    const conteudo = $(element).html() || "";
    const matches = conteudo.matchAll(
      /https?:\\?\/\\?\/[^"'`\s\\]+|\/[A-Za-z0-9_./%?=&-]+\.(?:webp|jpe?g|png|gif)(?:\?[^"'`\s]*)?/gi,
    );
    for (const match of matches) adicionar(imagensFallback, match[0]);
  });

  const galeriaFiltrada = filtrarBemDominante([...imagensGaleria]);
  return galeriaFiltrada.length > 0 ? galeriaFiltrada : filtrarBemDominante([...imagensFallback]);
}

async function baixarImagem(url, destino) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": USER_AGENT },
    timeout: 30000,
  });
  await fs.writeFile(destino, response.data);
  return response.headers["content-type"];
}

async function ziparPasta(origem, destinoZip) {
  await fs.ensureDir(path.dirname(destinoZip));
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinoZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(origem, path.basename(origem));
    archive.finalize();
  });
}

async function extrairRogerioMenezes(leilaoId) {
  const pastaLeilao = path.resolve(process.cwd(), "downloads", `leilao-${leilaoId}-rogerio-menezes`);
  const zipFinal = `${pastaLeilao}.zip`;
  const linksUnicos = new Set();
  const linksLotes = [];
  const erros = [];

  await fs.remove(pastaLeilao);
  await fs.ensureDir(pastaLeilao);

  for (let page = 1; page <= MAX_PAGINAS; page += 1) {
    const url = `${BASE_URL}/leilao/${leilaoId}?page=${page}`;
    console.log(`Pagina de listagem: ${url}`);
    try {
      const html = await buscarHtml(url);
      const linksPagina = extrairLinksLotes(html);
      const novos = linksPagina.filter((link) => !linksUnicos.has(link));
      console.log(`Links novos na pagina: ${novos.length}`);

      if (novos.length === 0) break;

      for (const link of novos) {
        linksUnicos.add(link);
        linksLotes.push(link);
      }
      await sleep(DELAY_PAGINA_MS);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro na pagina";
      erros.push({ tipo: "pagina", pagina: page, mensagem });
      console.log(`Erro na pagina ${page}: ${mensagem}`);
      break;
    }
  }

  console.log(`Total de lotes unicos: ${linksLotes.length}`);

  for (const [index, loteUrl] of linksLotes.entries()) {
    const loteId = loteUrl.match(/\/lote\/(\d+)\//)?.[1] || String(index + 1);
    console.log(`\nLote ${index + 1}/${linksLotes.length} - ID ${loteId}`);

    const errosLote = [];
    try {
      await sleep(DELAY_LOTE_MS);
      const html = await buscarHtml(loteUrl);
      const $ = cheerio.load(html);
      const numeroLote = extrairNumeroLote($, index + 1);
      const titulo = extrairTitulo($);
      const imagens = extrairImagens(html);
      const pastaLote = path.join(
        pastaLeilao,
        `lote-${String(numeroLote).padStart(3, "0")}-${nomeSeguro(loteId)}`,
      );
      const arquivosBaixados = [];

      await fs.ensureDir(pastaLote);
      console.log(`Numero do lote: ${numeroLote}`);
      console.log(`Imagens encontradas: ${imagens.length}`);

      for (const [imageIndex, imagemUrl] of imagens.entries()) {
        try {
          await sleep(DELAY_IMAGEM_MS);
          const extensaoUrl = extensaoImagem(imagemUrl);
          const nomeBase = String(imageIndex + 1).padStart(2, "0");
          const destinoTemporario = path.join(pastaLote, `${nomeBase}${extensaoUrl}`);
          const contentType = await baixarImagem(imagemUrl, destinoTemporario);
          const extensaoFinal = extensaoImagem(imagemUrl, contentType);
          const destinoFinal = path.join(pastaLote, `${nomeBase}${extensaoFinal}`);

          if (destinoFinal !== destinoTemporario) {
            await fs.move(destinoTemporario, destinoFinal, { overwrite: true });
          }

          arquivosBaixados.push(path.basename(destinoFinal));
          console.log(`Baixada: ${path.basename(destinoFinal)}`);
        } catch (error) {
          const mensagem = error instanceof Error ? error.message : "Erro ao baixar imagem";
          errosLote.push({ tipo: "imagem", url: imagemUrl, mensagem });
          erros.push({ loteId, tipo: "imagem", url: imagemUrl, mensagem });
          console.log(`Erro em imagem: ${mensagem}`);
        }
      }

      await fs.writeJson(
        path.join(pastaLote, "dados.json"),
        {
          leilaoId,
          loteId,
          numeroLote,
          titulo,
          loteUrl,
          imagensEncontradas: imagens,
          arquivosBaixados,
          erros: errosLote,
        },
        { spaces: 2 },
      );
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro ao processar lote";
      erros.push({ loteId, tipo: "lote", url: loteUrl, mensagem });
      console.log(`Erro no lote: ${mensagem}`);
    }
  }

  await fs.writeJson(path.join(pastaLeilao, "relatorio.json"), { leilaoId, totalLotes: linksLotes.length, erros }, { spaces: 2 });
  await ziparPasta(pastaLeilao, zipFinal);

  console.log(`\nPasta final: ${pastaLeilao}`);
  console.log(`ZIP final: ${zipFinal}`);
  console.log(`Erros encontrados: ${erros.length}`);
}

const leilaoId = process.argv[2];
if (!leilaoId || !/^\d+$/.test(leilaoId)) {
  console.error("Uso: node scripts/extrair-rogerio-menezes.js 1550");
  process.exit(1);
}

extrairRogerioMenezes(leilaoId).catch((error) => {
  console.error(error);
  process.exit(1);
});
