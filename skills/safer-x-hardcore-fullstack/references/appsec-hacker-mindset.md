# AppSec — Mentalidade de Hacker Aplicada a Quem Constrói

Índice: 1. Escopo ético · 2. Threat modeling · 3. Mapa OWASP → controles · 4. Código seguro (Node/Python/Front) · 5. Headers e CSP para sites animados · 6. Auth e sessão · 7. Supply chain · 8. Roteiro de pentest autorizado · 9. Relatório de achados

## 1. Escopo ético
Teste ofensivo apenas em: sistemas próprios, clientes com autorização escrita (escopo, janelas, contatos), CTFs e laboratórios (OWASP Juice Shop, DVWA, PortSwigger Web Security Academy). Sem autorização, a atividade pode configurar crime (no Brasil, Lei 12.737/2012 — invasão de dispositivo informático). Esta skill recusa ataque a terceiros, malware e evasão de detecção com fim malicioso, e oferece a alternativa defensiva.

## 2. Threat modeling (STRIDE em 15 minutos)
Desenhe o fluxo de dados (usuário → front → API → banco/terceiros) e marque fronteiras de confiança. Para cada fronteira pergunte:
- **S**poofing: alguém finge ser outro? → autenticação forte, passkeys, MFA.
- **T**ampering: altera dados em trânsito/repouso? → TLS, assinaturas, validação no servidor.
- **R**epudiation: nega ter feito? → logs de auditoria imutáveis.
- **I**nformation disclosure: vaza dados? → authz por objeto, minimização, erros genéricos.
- **D**enial of service: derruba? → rate limit, timeouts, limites de payload, filas.
- **E**levation of privilege: vira admin? → RBAC/ABAC no servidor, menor privilégio.

## 3. Mapa OWASP → controles
Referências: OWASP Top 10 (2021; verifique se a edição 2025 já está finalizada), OWASP API Security Top 10 (2023), OWASP ASVS (v5.0, 2025) para requisitos verificáveis, OWASP MASVS para mobile, OWASP Top 10 for LLM Applications para IA.

| Risco | Controle principal |
|---|---|
| Broken Access Control / BOLA | Filtrar todo acesso por dono/tenant no servidor; testes automatizados de "usuário A acessa recurso de B" |
| Cryptographic Failures | TLS 1.2+, HSTS, Argon2id/bcrypt para senhas, nunca criptografia caseira |
| Injection | Queries parametrizadas/ORM, sem `exec`/`eval`, escaping por contexto no template |
| Insecure Design | Threat modeling, limites de negócio (ex.: máx. tentativas, valor) |
| Security Misconfiguration | Headers, sem debug em produção, CORS restrito, buckets privados |
| Vulnerable Components | Lockfile, Dependabot/Renovate, `npm audit`, `pip-audit`, SCA no CI |
| Auth Failures | Rate limit no login, MFA/passkeys, sessão revogável, sem enumeração de usuário |
| Integrity Failures | SRI em CDN, assinatura de artefatos, sem deserializar dado não confiável |
| Logging Failures | Logs de eventos de segurança, alertas, sem segredos nos logs |
| SSRF | Allowlist de destinos, bloqueio de IPs internos/metadata (169.254.169.254), resolver DNS e validar IP |

## 4. Código seguro — padrões certo × errado
```js
// ERRADO: XSS
el.innerHTML = userComment;
// CERTO
el.textContent = userComment;            // ou DOMPurify.sanitize() se HTML for necessário
```
```js
// ERRADO: SQL injection
db.query(`SELECT * FROM users WHERE email = '${email}'`);
// CERTO
db.query('SELECT * FROM users WHERE email = $1', [email]);
```
```python
# ERRADO: execução de comando / deserialização
subprocess.run(f"convert {filename} out.png", shell=True); pickle.loads(data); yaml.load(s)
# CERTO
subprocess.run(["convert", safe_path, "out.png"], check=True, timeout=30); json.loads(data); yaml.safe_load(s)
```
```python
# Comparação de segredos em tempo constante
import hmac; hmac.compare_digest(sig_recebida, sig_calculada)
```
Upload de arquivos: valide tipo pelo conteúdo (magic bytes), limite tamanho, renomeie com UUID, armazene fora do webroot (object storage privado + URL assinada), nunca sirva com o `Content-Type` enviado pelo cliente.
React: `dangerouslySetInnerHTML` só com DOMPurify; links de usuário validados (`javascript:` bloqueado); Next.js Server Actions também precisam de authz (são endpoints públicos).

## 5. Headers e CSP para sites com GSAP/Three/CDN
```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://unpkg.com 'nonce-{RANDOM}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.seudominio.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```
- GSAP aplica estilos via CSSOM (`element.style.x = ...`), que a CSP não bloqueia; atributos `style=""` escritos no HTML são bloqueados sem `'unsafe-inline'`. Teste no navegador.
- Three.js com loaders de Draco/KTX2 usa Web Workers/WASM: inclua `worker-src blob:` e `script-src 'wasm-unsafe-eval'` se necessário.
- Use SRI (`integrity="sha384-..."` + `crossorigin="anonymous"`) em scripts de CDN.
- Comece com `Content-Security-Policy-Report-Only` e um endpoint de relatórios antes de impor.
Verifique com securityheaders.com ou Mozilla Observatory (apenas domínios seus ou autorizados).

## 6. Auth e sessão
- Web: cookie de sessão `HttpOnly; Secure; SameSite=Lax` (ou `Strict`), prefixo `__Host-`, rotação após login, expiração por inatividade.
- JWT: algoritmo fixo (rejeite `none`), validade curta (5–15 min), refresh token rotativo com detecção de reuso, valide `iss`, `aud`, `exp`. Não guarde tokens em `localStorage` em apps web com risco de XSS.
- Senhas: Argon2id (parâmetros OWASP Password Storage Cheat Sheet), verificação contra senhas vazadas (k-anonymity do HIBP), sem regras de composição absurdas (NIST SP 800-63B).
- CSRF: SameSite + token sincronizado para formulários com cookie; APIs com bearer token não precisam, mas CORS restrito sim.

## 7. Supply chain
Lockfiles commitados, `npm ci`/`uv sync --frozen`, revisar pacotes novos (idade, mantenedores, downloads, scripts `postinstall`), typosquatting, pin de GitHub Actions por SHA, `gitleaks` para segredos, SBOM (CycloneDX) em releases.

## 8. Roteiro de pentest autorizado (aplicação web/API)
1. **Escopo e regras** por escrito. 2. **Recon passivo**: tecnologias, rotas do bundle JS, `robots.txt`, sitemap, source maps expostos. 3. **Mapeamento** com proxy (Burp Suite / OWASP ZAP). 4. **Auth**: força bruta controlada, enumeração, reset de senha, fixação de sessão, JWT. 5. **Autorização**: troque IDs entre duas contas (BOLA/IDOR), endpoints de admin, métodos HTTP alternativos. 6. **Entrada**: injeções, XSS refletido/armazenado/DOM, SSTI, SSRF, path traversal, upload. 7. **Lógica de negócio**: valores negativos, corridas (race conditions), pular etapas. 8. **Config**: headers, CORS, TLS, diretórios, verbose errors. 9. **Dependências**: versões com CVE conhecida. 10. **Relatório e reteste**.
Automação de apoio (só no escopo): `nuclei`, `ffuf`, `sqlmap` com cautela, `semgrep` (SAST), `trivy` (containers/IaC).

## 9. Relatório de achados (formato)
Para cada achado: título, severidade (CVSS v3.1/v4.0), ativo afetado, passos de reprodução, evidência, impacto de negócio, correção recomendada com código, referência (OWASP/CWE), status do reteste.
