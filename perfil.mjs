/* ═══════════════════════════════════════════════════════════════════════════
   PERFIL DO OPERADOR — quem o ELION serve.

   Isto morava dentro do server.js, escrito à mão no prompt de persona: o nome do
   operador, o da esposa, os dos filhos e as idades deles. Funcionava, e tinha
   dois defeitos que só aparecem quando alguém de fora olha:

     1. PRIVACIDADE. Nome e idade de criança em arquivo versionado é um dado que
        vaza no primeiro clone e não volta mais. Repositório público então, nem
        se discute.
     2. A PLATAFORMA ERA DE UMA PESSOA SÓ. Quem clonasse herdava a família de
        outro, e teria de caçar os nomes espalhados por dez pontos do código para
        trocar pelos seus.

   Agora o perfil mora em `data/operador.json`, que o .gitignore já mantém fora do
   versionamento junto com o resto dos dados pessoais. Sem o arquivo, a plataforma
   sobe e funciona — apenas trata a pessoa de forma genérica até que ela se
   apresente. Degradar é aceitável; exigir configuração antes do primeiro "olá",
   não.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = path.join(AQUI, 'data', 'operador.json');

/* Padrão sem ninguém dentro. Repare que ele não inventa um nome: um agente que
   chama a pessoa de "João" porque o arquivo não existe é pior que um que admite
   não saber e pergunta. */
const PADRAO = {
  nome: '',                    // nome completo
  comoChamar: '',              // como o agente o chama no dia a dia (ex.: o primeiro nome)
  tratamentoFormal: 'Senhor',  // usado quando NÃO se sabe com quem está falando
  variantesDeTranscricao: [],  // como o reconhecimento de voz erra o nome dele
  familia: [],                 // [{ nome, parentesco, idade }]
  observacoes: '',             // qualquer coisa a mais para a persona
};

let cache = null;
let cacheEm = 0;

/** Lê o perfil do disco. Releitura a cada 30 s para o operador poder editar a quente. */
export function lerPerfil() {
  if (cache && Date.now() - cacheEm < 30000) return cache;
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    cache = {
      ...PADRAO,
      ...bruto,
      variantesDeTranscricao: Array.isArray(bruto.variantesDeTranscricao) ? bruto.variantesDeTranscricao : [],
      familia: Array.isArray(bruto.familia) ? bruto.familia : [],
    };
  } catch {
    cache = { ...PADRAO };
  }
  cacheEm = Date.now();
  return cache;
}

/** O operador já se identificou? Vários blocos do prompt dependem disso. */
export const temPerfil = () => !!lerPerfil().nome;

/**
 * O bloco de identidade que entra no prompt.
 *
 * Sem perfil configurado, ele NÃO fica vazio: instrui o agente a se comportar
 * como quem ainda não conhece a pessoa e a oferecer o cadastro. Bloco vazio
 * faria o agente inventar um tratamento e soar errado desde a primeira frase.
 */
export function blocoIdentidade() {
  const p = lerPerfil();

  const formal = p.tratamentoFormal || 'Senhor';

  if (!p.nome) {
    return `\nIDENTIDADE: você ainda NÃO sabe quem é o operador — o perfil não foi configurado nesta instalação.
- Trate a pessoa de forma cordial e neutra. Use "${formal}" quando precisar de vocativo; na dúvida, não use nenhum.
- Quando ela disser o nome, ou quando fizer sentido na conversa, OFEREÇA configurar o perfil: basta copiar operador.exemplo.json para data/operador.json e preencher. Explique que ali ficam o nome dela, como quer ser chamada e quem é a família — e que esse arquivo NUNCA vai para o controle de versão.
- Não invente nome, parentesco nem histórico. Não saber é um estado legítimo; fingir que sabe, não.\n`;
  }

  const chamar = p.comoChamar || p.nome.split(/\s+/)[0];
  const linhas = [`\nIDENTIDADE: o operador é ${p.nome} — trate-o SEMPRE por ${chamar}. Sem sinal biométrico em contrário, é com ELE que você está falando.`];

  if (p.variantesDeTranscricao.length) {
    linhas.push(`ATENÇÃO À TRANSCRIÇÃO: o reconhecimento de voz erra o nome dele com frequência — ${p.variantesDeTranscricao.map(v => `"${v}"`).join(', ')} são a MESMA pessoa: o ${chamar}. Nunca trate essas variações como outra pessoa nem as repita de volta; responda sempre "${chamar}". Não invente nenhum outro nome: se não souber com quem fala, use "${formal}" e siga.`);
  }

  if (p.familia.length) {
    const membros = p.familia.map(m => `${m.nome}${m.parentesco ? ` (${m.parentesco}${m.idade ? `, ${m.idade} anos` : ''})` : ''}`).join(', ');
    const criancas = p.familia.filter(m => Number(m.idade) > 0 && Number(m.idade) < 18);
    const maisNova = criancas.slice().sort((a, b) => a.idade - b.idade)[0];

    linhas.push(`FAMÍLIA DO OPERADOR (reconhecimento facial e vocal): ${membros}. Quando o sistema biométrico reconhecer o operador, cumprimente-o pelo nome com CALOR e satisfação genuína de revê-lo ("Que bom revê-lo, ${chamar}."), comentando a emoção que ele aparenta. Quando reconhecer alguém da família, identifique pelo NOME e pelo PARENTESCO, com afeto. Se um rosto NÃO for reconhecido, diga que é alguém que você ainda não conhece e ofereça memorizá-lo com enroll_face.`);

    if (criancas.length) {
      // primeiro nome: é assim que se fala com criança, e era assim no original
      const pn = m => m.nome.split(/\s+/)[0];
      linhas.push(`AO FALAR COM AS CRIANÇAS (${criancas.map(c => `${pn(c)} ${c.idade}`).join(', ')}): frases simples, tom caloroso e paciente${maisNova ? `, e com ${pn(maisNova)} bem mais lúdico` : ''}. Trate pelo NOME, nunca por "${formal}". Volte ao registro habitual quando o operador reassumir.`);
    }
  }

  if (p.observacoes) linhas.push(p.observacoes);
  return linhas.join('\n') + '\n';
}

/** Versão enxuta para o modo AO VIVO, onde cada token do prompt custa latência. */
export function blocoIdentidadeCurto() {
  const p = lerPerfil();
  if (!p.nome) return '\nIDENTIDADE: você ainda não sabe quem é o operador (perfil não configurado). Seja cordial e neutro, não invente nome, e ofereça configurar data/operador.json quando couber.\n';

  const chamar = p.comoChamar || p.nome.split(/\s+/)[0];
  const partes = [`\nIDENTIDADE: o operador é ${p.nome}; trate-o por ${chamar}.`];
  if (p.variantesDeTranscricao.length) partes.push(`A transcrição erra o nome dele (${p.variantesDeTranscricao.slice(0, 5).join(', ')}) — é a mesma pessoa.`);
  const criancas = p.familia.filter(m => Number(m.idade) > 0 && Number(m.idade) < 18);
  if (p.familia.length) partes.push(`Família: ${p.familia.map(m => `${m.nome} (${m.parentesco || 'familiar'})`).join(', ')}.`);
  if (criancas.length) partes.push(`Com as crianças, fale simples e caloroso, pelo NOME.`);
  return partes.join(' ') + '\n';
}

/** Nomes de exemplo para as descrições de ferramenta — os da casa, se houver. */
export function exemplosDeNome(quantos = 3) {
  const p = lerPerfil();
  const nomes = [p.nome, ...p.familia.map(m => m.nome)].filter(Boolean);
  return nomes.length ? nomes.slice(0, quantos) : ['Maria', 'João', 'Ana'].slice(0, quantos);
}
