/**
 * GALERIA DE ESTILOS — o "cardápio" que o cliente vê antes de comprar.
 *
 * Cada estilo explica, em linguagem de cliente: o que é, para que serve e
 * o que ele precisa mandar. `preview` escolhe o tema animado (CSS) usado na
 * miniatura e no preview do estúdio. `example` (opcional) é uma imagem de
 * referência do estilo; quando existe, substitui a miniatura animada na galeria.
 */
export const STYLE_GALLERY = [
  /* ── IMAGEM ─────────────────────────────────────────────────────── */
  {
    id: 'still-estudio', medium: 'image', name: 'Still de estúdio', preview: 'minimalista',
    summary: 'O produto sozinho, em fundo limpo e luz de estúdio.',
    description: 'A foto clássica de catálogo: fundo neutro (branco, cinza ou na cor da marca), sombra suave e o produto como único protagonista. Passa confiança e mostra cada detalhe.',
    idealFor: ['Loja virtual e marketplace', 'Catálogo e cardápio', 'Anúncio de preço'],
    send: 'Fotos do produto de frente, de lado e em detalhe, com boa luz.',
  },
  {
    id: 'luxo-editorial', medium: 'image', name: 'Editorial de luxo', preview: 'cinematico',
    summary: 'Luz dramática, fundos escuros, mármore, seda e reflexos.',
    description: 'Estética de revista de moda: contraste alto, brilho controlado e materiais nobres no cenário. Faz o produto parecer mais caro e desejável.',
    idealFor: ['Perfumes', 'Joias e relógios', 'Cosméticos premium', 'Bebidas'],
    send: 'Fotos nítidas do produto e, se houver, da embalagem.',
  },
  {
    id: 'lifestyle', medium: 'image', example: { thumb: '/assets/examples/lifestyle-thumb.webp', full: '/assets/examples/lifestyle.webp', alt: 'Pacote de café sobre a mesa do café da manhã, com croissant, frutas e uma pessoa segurando a xícara sob luz natural' }, name: 'Lifestyle', preview: 'lifestyle',
    summary: 'O produto em uso, num ambiente real do dia a dia.',
    description: 'Mostra o produto na vida do cliente: na mesa do café, na bolsa, no banheiro, na academia. Gera identificação e funciona muito bem no feed.',
    idealFor: ['Redes sociais', 'Moda e acessórios', 'Casa e decoração', 'Alimentos'],
    send: 'Fotos do produto e uma descrição do ambiente que combina com seu público.',
  },
  {
    id: 'flat-lay', medium: 'image', example: { thumb: '/assets/examples/flat-lay-thumb.webp', full: '/assets/examples/flat-lay.webp', alt: 'Fone de ouvido sem fio e estojo vistos de cima, cercados por caixa, celular, cabo, caderno e café' }, name: 'Flat lay', preview: 'flatlay',
    summary: 'Vista de cima, com objetos organizados ao redor.',
    description: 'Composição fotografada de cima para baixo, com itens que contam uma história (ingredientes, acessórios, folhas, tecidos). Visual organizado e muito "instagramável".',
    idealFor: ['Cosméticos e skincare', 'Kits e presentes', 'Gastronomia', 'Papelaria'],
    send: 'Fotos do produto e itens que você quer ver na composição.',
  },
  {
    id: 'pop-colorido', medium: 'image', example: { thumb: '/assets/examples/pop-colorido-thumb.webp', full: '/assets/examples/pop-colorido.webp', alt: 'Anúncio de caixa de som Bluetooth com cores vibrantes, formas gráficas e lista de benefícios' }, name: 'Pop colorido', preview: 'divertido',
    summary: 'Cores vibrantes, formas gráficas e energia.',
    description: 'Fundos saturados, formas geométricas, contrastes ousados e muita personalidade. Para chamar atenção na rolagem e falar com público jovem.',
    idealFor: ['Promoções e lançamentos', 'Público jovem', 'Delivery e fast food', 'Apps'],
    send: 'Fotos do produto e as cores da sua marca.',
  },
  {
    id: 'tech-neon', medium: 'image', example: { thumb: '/assets/examples/tech-neon-thumb.webp', full: '/assets/examples/tech-neon.webp', alt: 'Notebook gamer com teclado iluminado em cenário de cidade futurista com luzes neon' }, name: 'Futurista / neon', preview: 'futurista',
    summary: 'Luzes neon, grades digitais e clima tecnológico.',
    description: 'Ambientação sci-fi com luz azul e violeta, reflexos e elementos digitais. Comunica inovação e tecnologia.',
    idealFor: ['Eletrônicos e gadgets', 'Games', 'Software e startups', 'Eventos tech'],
    send: 'Fotos do produto ou logo em boa resolução.',
  },
  {
    id: 'retrato-pro', medium: 'image', example: { thumb: '/assets/examples/retrato-pro-thumb.webp', full: '/assets/examples/retrato-pro.webp', alt: 'Retrato profissional de homem de blazer em escritório com luz de fim de tarde' }, name: 'Retrato profissional', preview: 'retrato',
    summary: 'Sua foto com qualidade de ensaio, para marca pessoal.',
    description: 'Retratos com luz e enquadramento de estúdio a partir das suas fotos, com cenário corporativo, criativo ou ao ar livre. Só fazemos com fotos da própria pessoa, enviadas por ela.',
    idealFor: ['LinkedIn e currículo', 'Palestrantes e consultores', 'Perfil profissional', 'Autopromoção'],
    send: '5 a 10 selfies ou fotos suas, de rosto bem iluminado, sem óculos escuros.',
  },

  /* ── VÍDEO ──────────────────────────────────────────────────────── */
  {
    id: 'comercial-cinematografico', medium: 'video', name: 'Comercial cinematográfico', preview: 'cinematico',
    summary: 'Ritmo de trailer, câmera lenta e trilha marcante.',
    description: 'Planos amplos e closes com movimento de câmera, luz dramática e trilha épica. É o "comercial de TV" da sua marca, feito para impressionar.',
    idealFor: ['Lançamentos', 'Produtos premium', 'Institucional', 'YouTube e site'],
    send: 'Fotos do produto, a mensagem principal e o slogan, se tiver.',
  },
  {
    id: 'reels-dinamico', medium: 'video', name: 'Reels dinâmico', preview: 'dinamico',
    summary: 'Cortes rápidos no ritmo da música e texto grande na tela.',
    description: 'Feito para prender nos 2 primeiros segundos: gancho forte, cortes sincronizados com a batida, legendas grandes e chamada final clara. Linguagem nativa de Reels, TikTok e Shorts.',
    idealFor: ['Instagram Reels', 'TikTok', 'Promoções relâmpago', 'Divulgação diária'],
    send: 'Fotos do produto, a oferta e a chamada final (ex.: "Peça pelo WhatsApp").',
  },
  {
    id: 'produto-360', medium: 'video', name: 'Produto 360° e macro', preview: 'luxo',
    summary: 'O produto girando, com closes de cada detalhe e brilho.',
    description: 'Giro suave, zoom em texturas, reflexos e partículas de luz. Ideal para mostrar acabamento, pedras, rótulos e materiais.',
    idealFor: ['Joias e relógios', 'Perfumes', 'Eletrônicos', 'Calçados'],
    send: 'Fotos do produto de vários ângulos (frente, lados, costas, detalhes).',
  },
  {
    id: 'motion-grafico', medium: 'video', name: 'Motion graphics', preview: 'motion',
    summary: 'Textos, ícones e formas animadas explicando a oferta.',
    description: 'Animação gráfica com tipografia em movimento, ícones e transições. Explica serviços, preços e benefícios de forma clara, sem precisar de cenas filmadas.',
    idealFor: ['Prestadores de serviço', 'Promoções com preço', 'Eventos', 'Explicar como funciona'],
    send: 'Logo, cores da marca e os textos principais.',
  },
  {
    id: 'apresentador-ia', medium: 'video', name: 'Apresentador virtual', preview: 'avatar',
    summary: 'Um apresentador gerado por IA falando o seu roteiro.',
    description: 'Um personagem virtual (fictício) apresenta o produto ou serviço olhando para a câmera, com locução natural em português. Não imitamos pessoas reais nem criamos depoimentos falsos de clientes.',
    idealFor: ['Vídeos explicativos', 'Institucional', 'Treinamentos', 'Boas-vindas'],
    send: 'O roteiro ou os pontos principais que o apresentador deve falar.',
  },
  {
    id: 'ugc', medium: 'video', name: 'Estilo UGC', preview: 'ugc',
    summary: 'Visual de vídeo caseiro de celular, natural e próximo.',
    description: 'Câmera na mão, enquadramento vertical e legendas, como os vídeos que as pessoas postam. Parece espontâneo e costuma converter bem em anúncios. É uma estética: não simulamos avaliação de cliente real.',
    idealFor: ['Anúncios pagos', 'Produtos do dia a dia', 'Lojas online', 'Beleza'],
    send: 'Fotos do produto e os benefícios que você quer destacar.',
  },
];

export const CATEGORIES = [
  ['perfume', 'Perfume e fragrância'], ['joia', 'Joias, semijoias e relógios'], ['moda', 'Moda e acessórios'],
  ['beleza', 'Beleza e cosméticos'], ['alimento', 'Alimentos e bebidas'], ['casa', 'Casa e decoração'],
  ['servico', 'Serviço ou profissional'], ['evento', 'Evento'], ['tecnologia', 'Tecnologia'], ['outro', 'Outro'],
];

export const stylesFor = medium => STYLE_GALLERY.filter(s => s.medium === medium);
export const findStyle = id => STYLE_GALLERY.find(s => s.id === id) || null;
