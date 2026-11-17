# 1 · O agente lê o manual real da API do curso sem escrever nada

## Outcome

O Giovanni pode rodar o `payout-runner` em modo só leitura (`READ_ONLY=1`): o agente alcança `hq.mega.dev` com o ticket, lê o manual e o resume. Toda requisição passa por uma camada única que barra escritas, hosts de fora e vazamento de segredos.

## Done means

| Check | Shown by | Result |
|---|---|---|
| Testes da camada sem modelo (máscara, READ_ONLY, allowlist, redirects, GET-only do modelo, token de tentativa) | `node --test host-desk/roles/payout-runner/test/*.test.mjs` | match: 13/13; mutação (sem máscara, sem READ_ONLY) derrubou 5 |
| Rodada real só leitura a `/manual` | `./verify --slice 1` (run 2026-11-16T23-04-14-108Z) | match: 1 GET 200, nenhuma escrita, só a URL do manual, manual salvo, M5 limpo |

## Easy to miss

- `/api` é só um índice; o manual é `/manual`, e cada busca abre uma nova tentativa (KEEP.md).
- O token de tentativa é segredo: fica em `scripts/state/vars.json` (git-ignored) e aparece só como `{{ATTEMPT}}`.

## Not proven yet

- Escritas (pagamentos, respostas, `/parked`): ficam para as próximas issues.
