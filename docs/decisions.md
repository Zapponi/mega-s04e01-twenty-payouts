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
2026-11-16 — Segunda rodada da fatia 1: GET /manual (abre a tentativa nº 1), token de tentativa mascarado como {{ATTEMPT}}, < US$0,03 — who: human ("pode", em resposta a "posso fazer o ajuste do {{ATTEMPT}} e rodar uma vez … /manual (abre a tentativa nº 1, < US$0,03)?")
2026-11-16 — Abrir a prática hoje (POST /practice na tentativa nº 1, por script, sem modelo, sem responder nem pagar) para ver o formato real das tarefas — plan.md v2 § 2 — who: human ("1 - sim", em resposta a "Abrir a prática hoje à noite? POST /practice na tentativa nº 1, só para ver as 3 tarefas reais")
2026-11-16 — Quatro mudanças na prova: (1) "pague a outra conta" vira flag do dono; (2) o flag needs-owner é a única escrita permitida antes da decisão; (3) M1/M4 pelas respostas do curso no log + GET /parked; (4) fatia 3 = prática + lote na mesma tentativa, se a prática não mexer no relógio — plan.md v2 § 1 — who: human ("2 - ok", em resposta a "Mudanças na prova aprovada (um sim cobre as quatro)", com a tabela das quatro linhas)
2026-11-16 — Publicar as issues #4–#8 do plan.md v2 — split-plan — who: human ("3 - pode", em resposta a "Posso publicar a tabela da seção Issues do plano? Ela tem as issues #4 a #8")
2026-11-16 — Confirmação das três decisões acima (prática hoje, quatro mudanças na prova, issues #4–#8) — who: human ("1 - aprovo / 2 - aprovo / 3- aprovo", repetindo as respostas às mesmas três perguntas)
2026-11-16 — Arquitetura híbrida: o agente (LLM) lê e decide cada tarefa; o script de liquidação recalcula valor, confere conta, recusa o que viola regra, paga e responde em ms; tarefa fora do formato volta ao agente sem ação — enunciado ("an agent that works on its own", "their own model key") + lição S04E01 l.154 — who: human ("1 - sim", à pergunta "Arquitetura híbrida? O agente decide cada tarefa e o script de liquidação garante as regras e executa")
2026-11-16 — Prática de hoje rodada pelo agente no modelo do lote (openrouter/anthropic/claude-haiku-5.5), 10–15 chamadas, < US$0,05, 3 pagamentos de prática — who: human ("2 - ja no modelo que vamos usar", à pergunta "Prática hoje, rodada pelo agente (não por script)")
2026-11-16 — flow-ok: heredoc — 11 heredocs escreveram código pelo shell; daqui em diante, ferramenta de escrita — who: human ("3- ciente", ao aviso do desvio dos heredocs)
2026-11-16 — Janela da rodada real: o Giovanni avisa; a proposta 15:00–16:30 BRT de 17/11 fica em aberto — issue #2 — who: human ("4 - eu te aviso", em resposta a "Janela da rodada real (#2): proponho amanhã, das 15:00 às 16:30 BRT")
2026-11-16 — Uma recusa é qualquer resposta com `need`, status refused/rejected/denied, ou 4xx; a tarefa para, vai ao diário com o need e nunca é repetida — o índice não define o formato da recusa (KEEP.md) — who: agent (#6)
2026-11-16 — O manual só pode ser buscado enquanto não houver tentativa aberta (MANUAL_ONCE no lib/net.mjs, fim em attemptExpiresAt ou busca + 3 h); nenhum lote abre duas vezes na mesma tentativa, nem a prática — plan.md § 3 "never fetches /manual again" + KEEP.md (POST /practice reabre na tarefa 1) — who: agent (#6)
2026-11-16 — Cada token de tarefa fica também como TASK_<LOTE>_<n> e mascara como {{TASK_RUN_n}}, para o /parked achar a tarefa depois do flag e o ./verify ligar cada linha do log à sua tarefa — plan.md § 3 parked — who: agent (#6)
2026-11-16 — Prova em proof/checks.mjs, sem código comum com o agente (a regra do manual é reescrita lá); M2 por tarefa contra o timeLeftMs mostrado; M7 lê logs/check-lane.jsonl, uma linha por chamada de check-lane feita pelo harness — BRIEF.md Proof — who: agent (#6)
2026-11-16 — Re-mascarar os 3 logs locais da fatia 1 que guardavam o VERIFY_PATH da tentativa nº 1 sem máscara (uma troca por arquivo, com o mask() do lib/net.mjs) — #6, M5 ampliado — who: human ("pode remascarar")
2026-11-16 — flow-ok: one-thread — a #7 segue na thread da #6, que o AGENTS.md mandava parar ("A thread started for one issue does that issue and stops"); delegar como orquestrador se preciso — who: human ("continue aqui. Voce pode delegar como orquestrador se necessario")
2026-11-16 — Duas rodadas pagas do modelo no laboratório (haiku-5.5, ~40 chamadas e < US$0,15 cada), depois de rever a eficácia dos testes contra o enunciado e as armadilhas — issue #7 — who: human ("Verifique se o teste esta sendo efetivo vs os problemas que podem aparecerr, e cheque de novo o enunciado e as possiveis armadilhas e falhas. Após isso rode")
2026-11-16 — Rodadas pagas nº 2 e nº 3 do modelo no laboratório (haiku-5.5, ~40 chamadas e < US$0,15 cada); parar e perguntar se a nº 2 falhar — issue #7 — who: human ("pode")
2026-11-16 — Contar a rodada nº 3 (checagens L verdes; 1ª conferência saiu 1 por teste intermitente, sem relação com o modelo) e fechar a #7; seguir para a #8 — who: human ("pode seguir", à pergunta com a opção 1 recomendada)
2026-11-17 — /rehearse numa branch (8-rehearse) com PR para main — check-flow --release (12 linhas sem resultado) — who: human ("Vamos fazer o 1 e o opcional")
2026-11-17 — Ensaio da prática real com o código novo: GET /manual (tentativa nova), check-key, prática pelo agente (~5 chamadas, < US$0,02), sem POST /run; linha nova em BRIEF.md "Outside actions approved" — who: human ("Vamos fazer o 1 e o opcional")
2026-11-17 — Rodada real do lote agora (MODE=run, ALLOW_RUN=1, haiku-5.5, ~40 chamadas, < US$0,15), com o Giovanni na página do Challenge — issue #8 — who: human ("bora", em resposta ao pedido de horário e de sim para a rodada real)
2026-11-17 — Plano depois da recusa: script de rotina (todas as tarefas numa só execução, uma conexão), dublê e M2 com o relógio do lote inteiro, testes, 2 rodadas pagas no lab (~10 chamadas, < US$0,10), revisão de outra família, depois a rodada real nº 2 numa tentativa nova (sim pedido na hora) — check-lane routine-script — who: human ("siga")
