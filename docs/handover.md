# Handover — S04E01 Twenty payouts (2026-11-16)
Objective: um agente (Host Desk `payout-runner`, Pi + vars/http/code) roda sozinho o lote de 20 pagamentos pela API do curso dentro do tempo-limite; claim aceito pelo curso (uuid c0000000-0000-4000-8000-0000005e04e1).
Decisions: todas em `docs/decisions.md` com as palavras do Giovanni. Destaques: enunciado oficial é a fonte da verdade; prova aprovada ("1 -aprovo essa prova"); fatia 1 lê o manual cedo em modo só leitura ("2 - aceito"); modelo openrouter/anthropic/claude-haiku-5.5, limite 5 USD; tabela de ações aprovada ("3 - sim, aprovo").
Current state:
- Branch `kickoff-brief` (no GitHub), último commit com plan.md revisado (110c633) + sessions. `main` = 3a0a1ba (desvio já fechado com flow-ok). check-flow: PASS.
- `BRIEF.md` formato kit, `AGENTS.md`, `plan.md` (§0–§7), `docs/reviews/2026-11-16-plan.md` (Sol + Claude, 13 achados, todos tratados).
- Kit instalado no minijack (pwsh 7.4.6 em ~/.local/opt/pwsh, 17 hooks em ~/.claude/settings.json); port Linux em PR https://github.com/Zapponi/mega-agent-kit/pull/4 (aberto, falta /sol-loop e um teste no Windows).
- Segredos: ticket + chave de prática em `host-desk/vars.json` (600, git-ignored); chave OpenRouter em `~/.pi/agent/auth.json`. Ticket vence 2026-11-17 21:44 UTC (18:44 BRT). Nunca ler/imprimir esses valores.
- Nenhuma chamada paga ainda. Manual da API NÃO lido. start-challenge chamado uma vez (não chamar de novo; usar resume-challenge com o ticket de vars.json).
Sources: enunciado = resposta do start-challenge + list-challenges; Host Desk = zip do curso; lições/logs = github.com/Zapponi/megadev; kit = ~/src/mega-agent-kit.
Done when (BRIEF.md "Done when"): ✘ 20 tarefas no prazo · ✘ tarefas do dono decididas e concluídas · ✘ ./verify verde · ✘ claim aceito · ✘ debrief · ✘ megadev challenges/s04e01/log.md · ✘ nota [fim].
Open questions (Giovanni):
1. Publicar as issues A (fatia 1: plan §0+§1), B (janela da rodada real, espera Giovanni), C (claim e veredito, bloqueada por B) em Zapponi/mega-s04e01-twenty-payouts? — pergunta feita, sem resposta.
2. Janela de horário da rodada real ("decidimos depois").
Approvals: tabela "Outside actions approved" do BRIEF.md (push/PR/issues no repo; chamadas pagas ao OpenRouter com custo antes; nota [fim]; push+PR do kit). Rodada real e claim: perguntar na hora.
Return route: ao terminar (ou bloqueado), `t3_thread_send` com environmentId fbf717ef-3cea-41d0-a0a8-8ce0e41ae96c, threadId 7aadc61f-9297-4086-a010-8892c9410baa, texto `[fim] S04E01 Twenty payouts: <result | question | blocked>`.
Next 3 steps: 1. Obter o sim às issues A/B/C e publicá-las (split-plan). 2. Branch `<A>-slice-1`: construir plan §0 (lib/net.mjs, mascaramento, allowlist, READ_ONLY) + testes sem modelo, depois §1 com `./verify --slice 1`. 3. Pedir ok da rodada paga da fatia 1 (nº de chamadas e custo) e rodar; parar se o relógio começar.
Read first: KEEP.md, BRIEF.md, AGENTS.md, plan.md, docs/reviews/2026-11-16-plan.md, docs/decisions.md, BRIEF-didatico-detalhado.md §5.
Don't:
- Commitar em main (os git hooks só existem nas branches pós-kickoff; ver KEEP.md).
- Editar arquivos com scripts que falham no meio sem conferir (um registro de revisão chegou antes do plano).
- Usar `!` antes de um comando que pode falhar por sintaxe para "provar" ausência (o git grep com erro passou como vazio).
- Mostrar ou colar ticket, chaves ou JSON cru no chat. Escrever ao Giovanni em pt-BR.
