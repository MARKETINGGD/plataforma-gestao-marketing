Coloque aqui o arquivo de aviso sonoro dos recados, com o nome exato:
recado.mp3

(pode ser .mp3 ou .wav — se mandar .wav, ajuste o caminho em
public/app.js, na linha "const recadoAudio = new Audio(...)")

21ª rodada: aviso sonoro do Chat da Equipe (mensagem nova) — arquivo de
áudio que a Raquel mandou, convertido pra mp3 com ffmpeg:
chat.mp3
(ver "const chatAudio = new Audio(...)" em public/app.js)

40ª rodada: aviso sonoro de "chamar atenção" (nudge) no Chat da Equipe —
arquivo de áudio que a Raquel mandou, convertido pra mp3 com ffmpeg:
nudge.mp3
(ver "const nudgeAudio = new Audio(...)" em public/app.js)

13ª melhoria (24/09/2026): a Raquel mandou um áudio NOVO pra substituir
o som de nudge.mp3 (mesmo arquivo/nome, só o conteúdo mudou), e um áudio
novo pra avisar quando o "rei" do REIS DO MARKETING muda:
reis.mp3
(ver "const reisAudio = new Audio(...)" em public/app.js)
