// Normaliza um telefone digitado de qualquer forma para apenas digitos.
// Ex.: "(13) 99999-8888" -> "13999998888"  |  "+55 13 99999-8888" -> "5513999998888"
export function normalizarNumero(raw) {
  if (raw == null) return '';        // AC3: null/undefined viram string vazia
  return String(raw).replace(/\D/g, ''); // AC1/AC2: mantem so os digitos
}
