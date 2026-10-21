# Design System, UI, UX e Realismo Visual

Índice: 1. Processo UX · 2. Tokens · 3. Tipografia e grid · 4. Componentes e estados · 5. Direção de arte premium · 6. Acessibilidade (WCAG 2.2 AA) · 7. Documentação do sistema

## 1. Processo UX (enxuto, mas real)
1. **Jobs-to-be-Done**: "Quando ___, quero ___, para ___". Uma por persona principal.
2. **Jornada e fluxos**: entrada → descoberta → prova (cases, números verificáveis) → ação. Cada seção da página responde a uma objeção do usuário.
3. **Arquitetura da informação**: mapa do site, rótulos testáveis (card sorting se houver tempo).
4. **Wireframe de baixa fidelidade** antes do visual; valide hierarquia em escala de cinza.
5. **Teste rápido**: 5 usuários encontram ~85% dos problemas de usabilidade graves (Nielsen, 2000) — use como heurística, não lei.
6. **Heurísticas de Nielsen** como checklist de revisão.

## 2. Tokens (três camadas)
```css
:root {
  /* primitivos */
  --gray-950: oklch(0.14 0.01 260); --gray-50: oklch(0.98 0.005 260);
  --blue-500: oklch(0.62 0.19 255); --lime-400: oklch(0.88 0.2 128);
  /* semânticos */
  --color-bg: var(--gray-950); --color-surface: oklch(0.2 0.012 260);
  --color-text: var(--gray-50); --color-muted: oklch(0.72 0.01 260);
  --color-brand: var(--blue-500); --color-accent: var(--lime-400);
  --color-danger: oklch(0.63 0.22 25); --color-success: oklch(0.72 0.17 150);
  /* espaço (base 4) */
  --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem; --space-24: 6rem;
  /* raio, sombra, motion */
  --radius-sm: 6px; --radius-md: 12px; --radius-xl: 28px;
  --shadow-2: 0 1px 2px rgb(0 0 0 / .3), 0 8px 24px rgb(0 0 0 / .25);
  --ease-out-expo: cubic-bezier(.16, 1, .3, 1); --ease-in-out: cubic-bezier(.65, 0, .35, 1);
  --dur-1: 150ms; --dur-2: 300ms; --dur-3: 600ms; --dur-4: 1000ms;
}
```
- OKLCH dá luminosidade perceptualmente uniforme (escalas harmônicas e contraste previsível). Suporte amplo em navegadores modernos desde 2023.
- Exporte tokens em JSON (formato W3C Design Tokens Community Group) e gere CSS/TS com Style Dictionary quando houver múltiplas plataformas (web + app).
- Tema claro/escuro: troque só a camada semântica.

## 3. Tipografia e grid
- Escala fluida: `--step-5: clamp(2.8rem, 1.6rem + 6vw, 7.5rem);` (gere com utopia.fyi).
- Máximo 2 famílias; títulos display com `letter-spacing` negativo (-0.02 a -0.05em), corpo 16–18px, linha 1.5–1.7, medida 60–75 caracteres.
- `font-display: swap`, preload da fonte do hero, subset (latin) e variável quando possível.
- Grid de 12 colunas com `grid-template-columns: repeat(12, minmax(0, 1fr))`, gutter fluido, container queries (`@container`) para componentes adaptativos.

## 4. Componentes e estados
Cada componente documenta: anatomia, variantes, tamanhos, estados (default, hover, focus-visible, active, disabled, loading, error, success, empty, skeleton), conteúdo longo/curto, RTL quando aplicável, comportamento em toque.
Base acessível recomendada: Radix UI / shadcn/ui (React), Headless UI, ou React Aria. Nunca recrie select, dialog e combobox do zero sem seguir o WAI-ARIA Authoring Practices.

## 5. Direção de arte premium (o que faz parecer caro)
- **Uma ideia visual dominante** e restrição: paleta curta, 1 acento forte, muito espaço negativo.
- **Tipografia como imagem**: títulos gigantes, quebras intencionais, mistura serif display + grotesk.
- **Ritmo**: alterne seções densas e respiros; variação de escala dramática.
- **Textura e luz**: ruído sutil (grain 2–4% via SVG `feTurbulence`), gradientes de malha, glassmorphism com contraste suficiente, sombras em camadas.
- **Fotografia/3D realista**: iluminação coerente entre imagens, mesma temperatura de cor, renders com HDRI. Imagens licenciadas ou geradas com direitos claros.
- **Microinterações com propósito**: feedback em < 100 ms, transições 150–400 ms em UI, 600–1200 ms em narrativas.
- **Detalhes**: favicon e OG image próprios, estados de erro bonitos, 404 desenhada, seleção de texto com cor da marca (`::selection`), scrollbar coerente.

## 6. Acessibilidade (WCAG 2.2 AA)
- Contraste: 4.5:1 texto normal, 3:1 texto grande e componentes de UI.
- Alvo de toque mínimo 24×24 CSS px (critério 2.5.8 da WCAG 2.2); recomendação prática 44×44.
- Foco visível e não obscurecido (2.4.11), sem dependência de arrastar (2.5.7 — ofereça alternativa).
- Semântica: landmarks, um `h1`, hierarquia de headings, `alt` útil, `aria-live` para feedback assíncrono.
- Movimento: `prefers-reduced-motion`, nada piscando > 3 vezes/s, autoplay com controle de pausa.
- Ferramentas: axe DevTools, Lighthouse, leitores de tela (NVDA, VoiceOver).

## 7. Documentação do sistema
Storybook (componentes + docs + testes de interação + axe addon) ou página `/design-system` interna. Inclua: princípios, tokens, componentes, padrões (formulários, tabelas, navegação), tom de voz, do/don't.
