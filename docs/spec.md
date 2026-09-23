# Spec: normalizarNumero — limpeza de telefone para WhatsApp

## Objetivo

Criar uma funcao `normalizarNumero(raw)` que recebe um telefone digitado de
qualquer jeito (com parenteses, espacos, tracos, +) e devolve so os digitos.
Serve para padronizar numeros antes de enviar pelo WhatsApp no ELION-X.

Arquivo de implementacao: `demo-loop/normalizar.js`
Arquivo de teste (ja existe): `demo-loop/normalizar.test.js`

## Criterios de aceite

- AC1 — Dado `"(13) 99999-8888"`, quando chamar `normalizarNumero`, entao retorna `"13999998888"` (so digitos).
- AC2 — Dado `"+55 13 99999-8888"`, quando chamar, entao retorna `"5513999998888"` (preserva o codigo do pais).
- AC3 — Dado `""` (vazio) ou `null`, quando chamar, entao retorna `""` (string vazia, sem quebrar).

## Fora de escopo

- Validar se o numero existe ou se o DDD e valido.
- Adicionar o sufixo `@c.us` do WhatsApp (fica para outra entrega).

## Restricoes tecnicas

- JavaScript puro (ESM), sem instalar nenhuma biblioteca nova.
- **Comando de verde:** `node --test demo-loop/normalizar.test.js` — deve passar com exit 0.
