const db = require('../db');

// Resolve o nome de exibição atual de uma pessoa pelo id de quem fez a
// ação (createdBy, uploadedBy, etc.) — pedido da Raquel na 20ª rodada:
// "os cadastros anteriores de demandas seguem com o nome do cargo, ajuste
// isso" e "nada pode ser excluído, e em toda atualização, atualize o que
// precisa". Antes, o nome era gravado como texto solto no momento da ação
// (um "retrato" congelado) — se a conta fosse renomeada depois (corrigindo
// um cadastro que tinha a função no lugar do nome, por exemplo), os
// registros antigos continuavam mostrando o texto velho pra sempre.
//
// Agora a leitura resolve o nome AO VIVO a partir do id salvo, olhando o
// campo Nome atual da conta — então qualquer correção futura na tela
// Usuários se reflete automaticamente em tudo que a pessoa já fez, sem
// reescrever ou apagar nada no banco. Continua guardando o texto também
// (parâmetro fallback) só pro caso do id não existir (registros de antes
// desse campo existir) ou da conta ter sido removida — nesses casos, o
// texto antigo aparece em vez de ficar em branco, preservando o histórico.
function resolveUserName(userId, fallback) {
  if (userId) {
    const u = db.get('users').find({ id: userId }).value();
    if (u) return u.name || u.username;
  }
  return fallback || '';
}

// Foto de perfil atual da pessoa (20ª rodada: "no bate papo e no calendário,
// cronograma, deve aparecer a fotinho da pessoa") — mesma lógica de
// resolução ao vivo pelo id, sem fallback de texto (não existe "foto
// antiga" gravada solta, é null quando a pessoa não tem foto cadastrada
// ou a conta não existe mais).
function resolveUserPhoto(userId) {
  if (!userId) return null;
  const u = db.get('users').find({ id: userId }).value();
  return (u && u.photoUrl) || null;
}

module.exports = { resolveUserName, resolveUserPhoto };
