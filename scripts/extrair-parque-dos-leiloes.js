/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const archiver = require("archiver");

const BASE_URL = "https://www.parquedosleiloes.com.br";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const DELAY_LOTE_MS = 700;
const DELAY_IMAGEM_MS = 250;
const MAX_PAGINAS_DETALHES = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarUrl(valor) {
  return new URL(valor, BASE_URL).toString();
}

function extensaoImagem(url) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(webp|jpe?g|png)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

function nomeSeguro(valor) {
  return String(valor).replace(/[\\/:*?"<>|]/g, "-").trim() || "sem-nome";
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

function extrairLinksLotes(html, leilaoId) {
  const $ = cheerio.load(html);
  const links = new Set();
  const pattern = `/leilao/${leilaoId}/lote/`;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && href.includes(pattern)) {
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
    $("body").text().slice(0, 3000),
  ];

  for (const texto of candidatos) {
    const match = texto.match(/lote\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d+)/i);
    if (match && match[1]) {
      return match[1];
    }
  }

  return fallback;
}

function extrairImagens(html) {
  const $ = cheerio.load(html);
  const imagens = new Set();
  const atributos = ["src", "data-src", "data-lazy", "data-original"];
  const escopo = $(".photos").length > 0 ? $(".photos") : $("body");

  escopo.find("img").each((_, element) => {
    for (const atributo of atributos) {
      const valor = $(element).attr(atributo);
      if (!valor) continue;

      const url = normalizarUrl(valor);
      if (/\/storage\/vehicles\//i.test(url) && /\.(webp|jpe?g|png)(\?.*)?$/i.test(url)) {
        imagens.add(url);
      }
    }
  });

  return [...imagens];
}

async function baixarImagem(url, destino) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": USER_AGENT },
    timeout: 30000,
  });

  await fs.writeFile(destino, response.data);
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

async function extrairParqueDosLeiloes(leilaoId) {
  const pastaLeilao = path.resolve(process.cwd(), "downloads", `leilao-${leilaoId}`);
  const zipFinal = `${pastaLeilao}.zip`;
  const erros = [];
  const linksUnicos = new Set();
  const linksLotes = [];

  await fs.remove(pastaLeilao);
  await fs.ensureDir(pastaLeilao);

  for (let page = 1; page <= MAX_PAGINAS_DETALHES; page += 1) {
    const urlDetalhes = `${BASE_URL}/leilao/${leilaoId}/detalhes${page > 1 ? `?page=${page}` : ""}`;
    console.log(`Acessando detalhes: ${urlDetalhes}`);
    const htmlDetalhes = await buscarHtml(urlDetalhes);
    const linksPagina = extrairLinksLotes(htmlDetalhes, leilaoId);
    const novosLinks = linksPagina.filter((link) => !linksUnicos.has(link));

    if (novosLinks.length === 0) {
      break;
    }

    for (const link of novosLinks) {
      linksUnicos.add(link);
      linksLotes.push(link);
    }

    await sleep(400);
  }

  console.log(`Lotes encontrados: ${linksLotes.length}`);

  for (const [index, loteUrl] of linksLotes.entries()) {
    const loteId = loteUrl.match(/\/lote\/(\d+)/)?.[1] || String(index + 1);
    console.log(`\nLote ${index + 1}/${linksLotes.length}: ${loteUrl}`);

    try {
      await sleep(DELAY_LOTE_MS);
      const htmlLote = await buscarHtml(loteUrl);
      const $ = cheerio.load(htmlLote);
      const numeroLote = extrairNumeroLote($, index + 1);
      const imagens = extrairImagens(htmlLote);
      const pastaLote = path.join(pastaLeilao, nomeSeguro(numeroLote));

      await fs.ensureDir(pastaLote);
      console.log(`Imagens encontradas: ${imagens.length}`);

      const imagensBaixadas = [];
      for (const [imageIndex, imagemUrl] of imagens.entries()) {
        try {
          await sleep(DELAY_IMAGEM_MS);
          const nomeArquivo = `${String(imageIndex + 1).padStart(2, "0")}${extensaoImagem(imagemUrl)}`;
          const destino = path.join(pastaLote, nomeArquivo);
          await baixarImagem(imagemUrl, destino);
          imagensBaixadas.push(imagemUrl);
          console.log(`Baixada: ${nomeArquivo}`);
        } catch (error) {
          const mensagem = error instanceof Error ? error.message : "Erro ao baixar imagem";
          erros.push({ lote: numeroLote, tipo: "imagem", url: imagemUrl, mensagem });
          console.log(`Erro em imagem: ${mensagem}`);
        }
      }

      await fs.writeJson(
        path.join(pastaLote, "dados.json"),
        {
          leilaoId,
          loteId,
          numeroLote,
          loteUrl,
          imagensBaixadas,
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
  console.error("Uso: node scripts/extrair-parque-dos-leiloes.js 1473");
  process.exit(1);
}

extrairParqueDosLeiloes(leilaoId).catch((error) => {
  console.error(error);
  process.exit(1);
});
