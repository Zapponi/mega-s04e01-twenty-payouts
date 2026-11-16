# Decisions

One line per decision, written when it is made, not at the end of the day:

`YYYY-MM-DD — <decision> — <why> — who: human | agent (<source>)`

`who: human` only for what only the human decides: money, accounts, public exposure, actions that cannot be undone, the product's purpose and users. Everything else is `who: agent`, with its source (the request, the spec, a measure, an earlier decision); the human vetoes those in a batch, not one by one.

A changed decision gets a new line that names the one it replaces. Findings (what was seen, with its source) go in `KEEP.md`, not here.

2026-11-16 — Fonte da verdade: o enunciado oficial (start-challenge + list-challenges) acima do Host Desk, do manual, das lições e dos logs — pedido do Giovanni — who: human ("considerasse como fonte da verdade o enunciado oficial")
2026-11-16 — Ações de fora aprovadas como tabela: push/branches/PRs/merges/issues no repo do Challenge, chamadas pagas ao OpenRouter com custo antes, nota [fim] — BRIEF.md "Outside actions approved" — who: human ("3 - sim, aprovo")
2026-11-16 — Limite de 5 USD na chave do OpenRouter; modelo a critério do agente — dinheiro é do Giovanni — who: human ("2 - pode sugerir voce, 5 dolares de limite")
2026-11-16 — Modelo `anthropic/claude-haiku-5.5` no OpenRouter — usa ferramentas, 1M de contexto, US$0,10/M entrada e US$0,50/M saída (openrouter.ai/api/v1/models) — who: agent (preços lidos em 2026-11-16)
2026-11-16 — Ticket gravado pelo agente uma vez em host-desk/vars.json (600, git-ignored); chave de prática e chave do modelo entregues por cartão de segredo, nunca no chat — who: human ("3 - ok", "3 - faça voce e peça a chave aqui pra mim")
2026-11-16 — Kit instalado no minijack com install.ps1 e kickoff.ps1 portados para Linux (PR Zapponi/mega-agent-kit#4) — who: human ("1 - tente fazer a instalacao, se nao der, conserte para que de para fazer", "isso, a instalacao tem que ser agnostica")
2026-11-16 — Fatia 1 só de leitura: o agente lê o manual real com o http travado em GET (READ_ONLY=1, em código), sem tocar tarefas — o laboratório precisa do formato real; risco de o relógio começar na leitura fica registrado — who: agent (BRIEF.md Proof; aguarda aprovação da prova)
2026-11-16 — flow-ok: proof-late — o commit 3a0a1ba (Host Desk) entrou antes da prova aprovada; o Giovanni foi informado — who: human ("2 - Sim, confirmo")
2026-11-16 — flow-ok: plan-late — o commit 3a0a1ba entrou antes da revisão do plano por duas famílias; a revisão roda agora, antes de mais trabalho — who: human ("2 - Sim, confirmo")
2026-11-16 — flow-ok: issues-late — o commit 3a0a1ba entrou antes do sim na tabela de issues; a tabela vem antes da próxima issue — who: human ("2 - Sim, confirmo")
2026-11-16 — O commit 3a0a1ba fica em main; daqui em diante só por branch e PR — who: human ("2 - Sim, confirmo")
2026-11-16 — Fatia 1 lê o manual real cedo, em modo só leitura (GET travado em código); se o relógio começar na leitura, parar e avisar — who: human ("2 - aceito")
2026-11-16 — Publicar as issues A, B e C em Zapponi/mega-s04e01-twenty-payouts (#1 fatia 1, #2 janela da rodada real, #3 claim, bloqueada por #2) — split-plan — who: human ("1 - sim")
2026-11-16 — Nenhum campo extra obrigatório nas issues além do corpo da split-plan (Source, Done when, Waits on, Blocked by) — o Giovanni deixou a escolha ao agente; o fecho do AGENTS.md já cobre o resto — who: agent ("2 - avalie voce")
2026-11-16 — Rodada paga da fatia 1 (READ_ONLY=1, haiku-5.5, 3–6 chamadas, < US$0,02) — issue #1 — who: human ("sim")
2026-11-16 — Segunda rodada da fatia 1: GET /manual (abre a tentativa nº 1), token de tentativa mascarado como {{ATTEMPT}}, < US$0,03 — who: human ("pode")
