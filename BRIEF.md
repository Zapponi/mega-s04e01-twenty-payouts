# Brief — S04E03 Three small changes

Challenge do curso MEGA.dev, uuid `c0000000-0000-4000-8000-0000005e04e3`. Preenchido em 2026-11-20 no formato do kit (`/kickoff`). Toda sessão lê `KEEP.md` e depois este arquivo. Os briefs anteriores estão em `docs/challenges/s04e01/` e `docs/challenges/s04e02/`. Nenhum ticket, tentativa ou chave aparece aqui.

**Fontes, em ordem de precedência:**
1. O enunciado oficial: a resposta do `start-challenge` de 2026-11-20 18:40Z mais a entrada em `list-challenges`.
2. O índice da API (`logs/s04e03/api-index.txt`) e o manual da tentativa (`logs/s04e03/manual-*.json`, depois do primeiro `GET /manual`).
3. O zip do time que o curso entregou (`team-e12fefc8.zip`, SHA-256 `e12fefc8…628a0d`): `roles/README.md` e os `ROLE.md` de critic, worker, integrator e planner.
4. O que o S04E01 e o S04E02 provaram (`KEEP.md`, `docs/challenges/`).

Se o manual contradisser este brief, eu paro e pergunto.

## The six lines

1. **Result:** o Host Desk ganha um time, e o curso aceita a tentativa.
   - Enunciado: "Give the Host Desk a team. Write its planner with your human, let the team take the host’s three change requests on the board, and run today’s payout batch on the merged work." (read in start-challenge `task`)
   - Done: "In one attempt, the plan is posted before any job starts, every job posts its change and changed only the files its plan gave it, and the payout batch passes." (read in start-challenge `done`)
   - O planner (`roles/planner/ROLE.md`) é escrito com o Giovanni. Critic, worker e integrator rodam como vieram, salvo o que o enunciado manda trocar (a URL do Challenge no lugar do marcador do ROLE.md).
   - O resultado aceito é o `claim-challenge` aprovado.

2. **Proof:** `./verify` (Node, sem dependências). Ele lê o log de requisições, o board da tentativa (`GET /board`) e as respostas do curso. Nunca usa o relatório do agente sobre si mesmo.

   **Checagens `must` do time (tudo numa só tentativa):**
   - **T1:** o `POST /board/plan` aceito tem 1 a 12 jobs, cada um de r1, r2 e r3 servido por um job, e exatamente um job com `request: merge` (api-index `plan`).
   - **T2:** o plano está no board antes de qualquer job começar: `plan.at` é anterior a todo `claimedAt` e a todo resultado (board).
   - **T3:** os arquivos dos jobs não se cruzam: nenhum caminho aparece em dois jobs do plano. Cada caminho é como o `git diff` o imprime a partir da pasta de topo do Host Desk.
   - **T4:** antes de cada `POST /board/results`, um script compara `git diff --name-only` do job com os `files` do job no plano e recusa o envio se houver um caminho a mais. Depois, no board, os `paths` de cada resultado estão dentro dos `files` do job.
   - **T5:** todo job do plano tem um resultado no board, e o resultado do integrator é o último.
   - **T6:** o `ranOn` de cada resultado é o `model` daquele job no plano.
   - **T7:** cada pedido (r1, r2, r3) recebe as perguntas do critic (`POST /board/questions`) antes do plano, e o Giovanni lê as respostas na página do dono antes de aprovar o plano.

   **Checagens `must` do lote (as do S04E02, com as URLs do S04E03):**
   - **B1:** o curso aceita o lote: todas as tarefas respondidas ou concluídas, segundo as respostas do curso.
   - **B2:** cada valor pago é `Math.floor(total × (1 − commissionPct/100))`, com `commissionPct` lido de `GET /settings` na mesma tentativa, ou a regra que as mudanças r1–r3 juntadas definirem; o destino é a conta cadastrada do manual, ou a tarefa vai ao dono.
   - **B3:** a chave de pagamento só vai a `pay-s04.mega.dev`.
   - **B4:** tarefa que espera o dono não recebe escrita antes da decisão dele na API.
   - **B5:** nenhum pagamento em dobro, no log e nas respostas.
   - **B6:** o lote roda no Host Desk juntado, depois do resultado do integrator.

   **Checagens `must` gerais:**
   - **S1:** o ticket, a tentativa, a chave de prática e o token do modelo não aparecem em log, diário, repo, board ou saída do agente. O `post-result.mjs` nunca manda `vars.json`.
   - **S2:** toda recusa com `pointer` foi parar no `check-lane` e nenhuma foi contornada.
   - **S3:** `factory/CHECKLIST.md` tem as regras 1–5 dos dias 1 e 2 antes de qualquer papel rodar (worker e integrator o leem; hoje ele está vazio).

   **Checagens `keep`:**
   - **K1:** as regras 6–7 do debrief vão para `factory/CHECKLIST.md`.

   **Fatias:**
   - **Fatia 1, ensaio no laboratório (fluxo do careca, 2026-11-20):** o planner roda no `/lab` do careca-kit contra um board de amostra fictício (`host-desk/lab/sample-board.json`, checagens em `planner-lab.md`), sem tocar o curso. O plano de amostra cumpre T1 e T3, e o planner não posta nada no modo Draft.
   - **Fatia 2, a tentativa real:** um `GET /manual`, o critic nos três pedidos, o Giovanni lê as respostas, o planner posta o plano, os workers em worktrees, o integrator com o revisor, e a prática do lote. T1–T7 e B2–B6 passam.
   - **Fatia 3:** o lote real (`POST /run`), as decisões do dono, `./verify` completo, `/rehearse` e o claim.

   Proof approved: (pendente)

3. **Judge:** o curso, pelo board, pelo `/run` e pelo `claim-challenge`. O board guarda o plano, os claims, os resultados com os caminhos que o curso tirou do diff, e as perguntas. O `/review` "not graded" só devolve os hunks marcados para o integrator (api-index). No lote, pelo S04E01 e pelo S04E02, ele recusa o tempo estourado, o segredo enviado a um host novo, a escrita antes da decisão do dono e o pagamento à conta errada. Só o claim aceito conta.

4. **Limits:**
   - O ticket vence em 2026-11-21 às 19:40:22 UTC (16:40 BRT de sábado). Cada `GET /manual` abre uma tentativa nova, válida por cerca de 3 h no S04E02. O Done pede tudo numa só tentativa: plano, jobs, resultados e lote.
   - Um só `GET /manual` por tentativa, feito por mim (não por um papel), e a tentativa vai para `vars.json` como `ATTEMPT`. "A role that fetches the manual itself starts a new attempt with an empty board." (read in roles/README.md)
   - Não chamar `start-challenge` de novo. Para retomar, usar `resume-challenge`.
   - Cada papel usa só as ferramentas do seu `run.mjs`. O planner lê e posta; ele não escreve código. O critic só pergunta. O worker faz um job. O integrator junta, pede o revisor e posta por último.
   - Plano: 1 a 12 jobs, até 40 caminhos por job, `asks` de até 20 linhas (api-index).
   - Modelo: assinatura Claude Pro/Max pelo Pi, `anthropic/claude-haiku-5-5` (docs/decisions.md 2026-11-18). Rodadas pagas não precisam do ok do Giovanni (2026-11-20, "eu nao preciso aprovar as rodadas pagas"); o número de sessões vai no log.
   - O Host Desk precisa ser a pasta de topo de um repositório git, com uma worktree por job ao lado (`git worktree add ../host-desk-w-1`, uma por id de job), porque os caminhos do plano são os que o `git diff` imprime a partir dessa pasta. Aqui o Host Desk é a subpasta `host-desk/` deste repo, então ele roda numa cópia própria em `~/Projects/zapponi/host-desk` (git local, não publicado), e o resultado juntado volta para `host-desk/` deste repo num PR.
   - Plataforma: esta máquina (Linux), Node 24, Pi 1.5. A máquina precisa estar livre na hora do lote.
   - Fora do escopo: dinheiro real, outra conta que não a de prática, e as tarefas do S04E04.

5. **Access:**
   - **Já checados (2026-11-20):** o ticket guardado só nesta máquina em `logs/s04e03/ticket.txt` (git-ignorado); o MCP `mega-challenge` conectado (`start-challenge` respondeu); o índice da API (200, sem auth).
   - **A checar na fatia 1:** o Pi e o token da assinatura nesta máquina (`pi --list-models`); o `gh` com ADMIN neste repo; o Codex CLI para o `/sol-loop`.
   - **Falta:** a chave de prática do S04E03, da página https://hq.mega.dev/challenges/three-small-changes (a mesma do S04E01 e do S04E02, pelo texto da página), em `vars.json` como `PAYOUT_KEY`.

6. **Autonomy:** trabalhar até as checagens `must` passarem e parar antes do claim. Eu paro e reporto se:
   - surgir uma ação de fora que não está na tabela abaixo;
   - um resultado diferir da expectativa escrita;
   - o escopo mudar;
   - uma verificação falhar duas vezes;
   - uma resposta do curso definir um valor que eu ainda não li;
   - o manual contradisser este brief.

## Glossary

- **board:** o quadro da tentativa no curso: pedidos do host (r1, r2, r3), plano, jobs, resultados e perguntas (`GET /board`).
- **pedido (request):** uma das três mudanças que o host pede no board.
- **job:** uma unidade do plano: id, papel dono, arquivos, pedido que serve e modelo.
- **plano:** a lista de jobs que o planner posta em `POST /board/plan`, antes de qualquer job começar.
- **tentativa (attempt):** o que um `GET /manual` abre; é o Bearer do board, de `/settings`, da prática e do lote.
- **Host Desk juntado:** o Host Desk depois que o integrator juntou todos os jobs.

## Outside actions approved

| Action | Where | Approved on |
|---|---|---|
| Baixar `team-e12fefc8.zip` e colocá-lo no Host Desk | `hq.mega.dev/media`, esta máquina | 2026-11-20: baixado e posto no Host Desk de `~/Projects/zapponi/host-desk`, no fluxo do careca que o Giovanni escolheu ("Você no Herdr (Recommended)") |
| Push, branches, PRs, merges, issues e comentários de fechamento | `Zapponi/mega-s04e01-twenty-payouts` | 2026-11-20 ("Aprovo as 4 (Recommended)") (table) |
| Rodadas do time e do lote com o modelo, no laboratório e no real | Pi com a assinatura Claude | 2026-11-20 ("eu nao preciso aprovar as rodadas pagas") |
| Um `GET /manual` (abre a tentativa), `GET /board`, `GET /settings`, `GET /patch`, `GET /parked` | `hq.mega.dev/challenges/three-small-changes` | 2026-11-20 ("Aprovo as 4 (Recommended)") (table) |
| Escritas do time no board: `POST /board/questions`, `/board/plan`, `/board/claims`, `/board/results`, `POST /review` | `hq.mega.dev/challenges/three-small-changes` | 2026-11-20 ("Aprovo as 4 (Recommended)") (table) |
| Prática do lote (`POST /practice`, pagamentos de prática) | `hq.mega.dev`, `pay-s04.mega.dev` (chave de prática) | 2026-11-20 ("Aprovo as 4 (Recommended)") (table) |

Fora desta tabela, e perguntados na hora: o lote real (`POST /run`), o `POST /parked` depois da decisão do dono, e o `claim-challenge`.

Release command: `claim-challenge` (MCP `mega-challenge`, uuid acima). Não tem volta.

## Outside services

| Service | Alternatives considered | Limit that matters (source) | Where it runs, volume with tests | At the limit | Checked from the real host |
|---|---|---|---|---|---|
| API do curso `hq.mega.dev/challenges/three-small-changes` | nenhuma: o enunciado a fixa | uma tentativa para tudo (start-challenge `done`); 1–12 jobs (api-index); diff até 32 KB por resultado (api-index); ticket até 2026-11-21 19:40Z | esta máquina; uma tentativa principal, ~15 escritas no board | sem tentativa, sem board; o ticket vencido para tudo | `GET /api` → 200 (2026-11-20) |
| API de pagamentos `pay-s04.mega.dev/three-small-changes/payouts` | nenhuma: o índice a fixa | chave de prática; um pagamento por tarefa | esta máquina; 3 na prática, 20 no lote | pagamento recusado; tarefa sem recibo vai ao dono | pendente: fatia 2 |
| Modelo `anthropic/claude-haiku-5-5` pela assinatura Claude | OpenRouter (custo por chamada) | cota da assinatura (Anthropic) | esta máquina; ~8 sessões por rodada do time | o Pi para com erro de cota; a rodada para no meio | pendente: fatia 1 |
| GitHub `Zapponi/mega-s04e01-twenty-payouts` | nenhuma | nenhum relevante | push desta máquina | não se aplica | pendente: fatia 1 |

## Product signals

Entrega de Challenge; o Host Desk continua no S04E04.

| Signal | Where it comes from | State |
|---|---|---|
| Telemetry | log de requisições, board da tentativa e diário das rodadas | planned |
| User feedback | respostas do host às perguntas do critic; claim | planned |
| Business context | enunciado: o planner divide e atribui, workers fazem um job cada, o integrator junta | fixado pelo enunciado |
| Product analytics | none yet | not needed |
| Lab or beta channel | dublê local da API (`lab/`) com o board | planned |

## Running without you

Não se aplica: toda rodada é acompanhada nesta thread, e o Giovanni lê as respostas do host e decide as tarefas do dono na página.

## Pre-mortem

Uma linha por frase do enunciado. A coluna Expected foi escrita antes do build. A coluna Result é preenchida pelo `/rehearse`.

| Sentence of the request | How the receiver may test it | Rehearsal | Expected | Result |
|---|---|---|---|---|
| "the plan is posted before any job starts" | compara `plan.at` com o primeiro claim e o primeiro resultado | fatia 1 no dublê | nenhum papel de job roda antes da resposta do `POST /board/plan`; o claim vem depois | |
| "every job posts its change" | conta os resultados contra os jobs do plano | fatia 1 no dublê | um resultado por job, o do integrator por último | |
| "changed only the files its plan gave it" | compara os `paths` do resultado com os `files` do job | guarda T4 no dublê, com um job que toca um arquivo a mais | o envio é recusado localmente; no real nenhum caminho fora do plano | |
| "In one attempt" | todos os eventos na mesma tentativa | `./verify` lê o board da tentativa de `vars.json` | um só `GET /manual` na fatia 2; nenhum papel o chama | |
| "Write its planner with your human" | o planner é seu, não o do curso | revisão do ROLE.md com o Giovanni | o ROLE.md do planner tem as seções preenchidas e aprovadas pelo Giovanni | |
| "let the team take the host’s three change requests on the board" | cada pedido tem um job e uma mudança | fatia 1 e 2 | r1, r2 e r3 servidos por workers; as perguntas do critic respondidas antes do plano | |
| "run today’s payout batch on the merged work" | o lote usa o código juntado | fatia 2 (prática) e 3 (real) | o payout-runner roda no Host Desk juntado, depois do resultado do integrator; o curso aceita o lote | |
| "A role that fetches the manual itself starts a new attempt with an empty board" (README) | um papel chama `/manual` | `./verify` procura `GET /manual` no log | só uma chamada, minha, antes dos papéis | |
| "the attempt goes to hq.mega.dev only, on every redirect too" (README) | redirecionamento para outro host | `hosts.json` de cada papel; caso de 307 no dublê | o `http` não leva a tentativa para fora; S1 passa | |
| "A refusal may end with a pointer: call check-lane" | recusa com `pointer` | recusa no dublê | registrada, não contornada, `check-lane` chamado (S2) | |

## Execução (fluxo do careca)

Decisão do Giovanni em 2026-11-20 ("Me ajude a fazer esse challenge a partir do careca kit", "seguindo o que seria o fluxo do careca", "Você no Herdr (Recommended)"): o Main é o Pi num painel do Herdr, em `~/Projects/zapponi/host-desk`, com o careca-kit. O Giovanni conduz o Main; o Claude (T3) prepara os arquivos, faz o único `GET /manual` e confere os painéis com `hc read`. Cada papel do time roda no seu painel; cada worker na sua worktree. O passo a passo do Main está em `host-desk/AGENTS.md` daquela pasta.

## Helpers

No máximo 3 helpers ao mesmo tempo (os workers do time não contam: eles são o produto). Cada helper tem o brief das linhas de que precisa e o próprio "pare e reporte se".

Revisões:
- O plano é revisado por duas famílias: Claude e Codex.
- Cada entrega passa por um `/sol-loop` sobre o diff inteiro.

## Left out on purpose

- **"Running without you":** toda rodada é acompanhada.

## Later

- Herdados do S04E02 (docs/challenges/s04e02/BRIEF.md "Later"): a máscara do revisor em percent-encoding; o `--slice 1` com R1 e R2; prender o snapshot da tentativa no `routine.mjs`; renomear o repo.
