/**
 * CATÁLOGO — fonte única de verdade dos preços.
 *
 * O navegador mostra preços, mas NUNCA os define: todo total é recalculado
 * aqui no servidor a partir dos ids. Um cliente que edite o HTML para pagar
 * R$ 1 recebe um checkout com o valor correto mesmo assim.
 *
 * Valores em centavos (inteiros) para nunca somar dinheiro em ponto flutuante.
 * Os preços abaixo são PONTO DE PARTIDA — ajuste ao seu custo real de geração.
 */
export const PACKAGES = [
  {
    id: 'foto-pro',
    revisions: 1,
    kind: 'photo',
    name: 'Foto Pro IA',
    tagline: 'Ensaio de produto ou perfil, sem estúdio',
    priceCents: 9700,
    deliverables: { images: 6, videos: 0 },
    durationSec: 0,
    slaHours: 24,
    features: ['6 fotos em alta resolução', 'Cenários gerados por IA', '1 rodada de ajuste'],
  },
  {
    id: 'reels-flash',
    revisions: 1,
    kind: 'video',
    name: 'Reels Flash',
    tagline: 'Vídeo curto que prende nos 2 primeiros segundos',
    priceCents: 19700,
    deliverables: { images: 0, videos: 1 },
    durationSec: 15,
    slaHours: 48,
    features: ['1 vídeo de até 15 s', 'Trilha e legendas', 'Formato vertical ou quadrado', '1 rodada de ajuste'],
  },
  {
    id: 'comercial-pro',
    revisions: 2,
    kind: 'video',
    name: 'Comercial Pro',
    tagline: 'Propaganda completa com roteiro e locução',
    priceCents: 49700,
    deliverables: { images: 2, videos: 1 },
    durationSec: 30,
    slaHours: 72,
    featured: true,
    features: ['1 vídeo de até 30 s', 'Roteiro assistido por IA', 'Locução + trilha', '2 capas/thumbnails', '2 rodadas de ajuste'],
  },
  {
    id: 'campanha-turbo',
    revisions: 3,
    kind: 'bundle',
    name: 'Campanha Turbo',
    tagline: 'Kit completo para lançar nas redes',
    priceCents: 129000,
    deliverables: { images: 10, videos: 3 },
    durationSec: 30,
    slaHours: 120,
    features: ['3 vídeos de até 30 s', '10 fotos de campanha', 'Variações por rede social', '3 rodadas de ajuste'],
  },
];

export const ADDONS = [
  { id: 'urgente', name: 'Entrega expressa', description: 'Prazo reduzido pela metade', percent: 40 },
  { id: 'formato-extra', name: 'Formato extra', description: 'Mesmo conteúdo em outra proporção', priceCents: 4900 },
  { id: 'legendas-en', name: 'Versão em inglês', description: 'Legendas e locução em inglês', priceCents: 7900 },
];

export const GOALS = ['vender-produto', 'autopromocao', 'lancamento', 'evento', 'institucional'];
export const STYLES = ['cinematico', 'divertido', 'minimalista', 'futurista', 'ugc'];
export const FORMATS = ['9:16', '1:1', '16:9'];

export const findPackage = id => PACKAGES.find(p => p.id === id) || null;

/** Calcula o orçamento. Lança erro com mensagem amigável se algo não existir. */
export function quote(packageId, addonIds = []) {
  const pkg = findPackage(packageId);
  if (!pkg) throw Object.assign(new Error('pacote inexistente'), { status: 400 });

  const unique = [...new Set(addonIds)];
  const lines = [{ id: pkg.id, label: pkg.name, cents: pkg.priceCents }];
  let slaHours = pkg.slaHours;

  for (const id of unique) {
    const a = ADDONS.find(x => x.id === id);
    if (!a) throw Object.assign(new Error(`adicional inexistente: ${id}`), { status: 400 });
    const cents = a.percent ? Math.round(pkg.priceCents * a.percent / 100) : a.priceCents;
    if (a.id === 'urgente') slaHours = Math.ceil(slaHours / 2);
    lines.push({ id: a.id, label: a.name, cents });
  }

  const totalCents = lines.reduce((s, l) => s + l.cents, 0);
  return { packageId: pkg.id, addons: unique, lines, totalCents, currency: 'BRL', slaHours };
}

/** Versão pública do catálogo (o que o frontend pode ver). */
export const publicCatalog = () => ({ packages: PACKAGES, addons: ADDONS, goals: GOALS, styles: STYLES, formats: FORMATS });
