import { describe, expect, it } from 'vitest'
import {
  formatBrazilianProfilePhone,
  normalizeProfileIdentifierForRequest,
  profileIdentifierRule,
  updateBrazilianProfilePhoneInput,
  updateProfileIdentifierInput,
} from '../src/services/profile-identifier.js'

describe('identificador do login de perfil', () => {
  it('formata telefones brasileiros de dez e onze dígitos', () => {
    expect(formatBrazilianProfilePhone('1131234567')).toBe('(11) 3123-4567')
    expect(formatBrazilianProfilePhone('11931234567')).toBe('(11) 9 3123-4567')
  })

  it('mantém a formatação durante a digitação e envia o país para a API', () => {
    const input = updateProfileIdentifierInput('11931234567')

    expect(input).toEqual({ mode: 'phone', value: '(11) 9 3123-4567' })
    expect(profileIdentifierRule(input.value, input.mode)).toBe(true)
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe('5511931234567')
  })

  it('aceita telefone brasileiro nacional e E.164 sem duplicar o DDI', () => {
    expect(formatBrazilianProfilePhone('61981748795')).toBe('(61) 9 8174-8795')
    expect(formatBrazilianProfilePhone('5561981748795')).toBe('(61) 9 8174-8795')
    expect(normalizeProfileIdentifierForRequest('61981748795', 'phone')).toBe('5561981748795')
    expect(normalizeProfileIdentifierForRequest('5561981748795', 'phone')).toBe('5561981748795')
  })

  it('aplica a máscara nacional sem aceitar mais de onze dígitos', () => {
    expect(updateBrazilianProfilePhoneInput('1131234567')).toBe('(11) 3123-4567')
    expect(updateBrazilianProfilePhoneInput('11931234567')).toBe('(11) 9 3123-4567')
    expect(updateBrazilianProfilePhoneInput('11931234567123')).toBe('(11) 9 3123-4567')
  })

  it('troca para email ao ultrapassar o telefone sem perder nenhum dígito', () => {
    const input = updateProfileIdentifierInput(
      '(11) 9 3123-45672',
      'phone',
      '(11) 9 3123-4567',
    )

    expect(input).toEqual({ mode: 'email', value: '119312345672' })
    expect(profileIdentifierRule(input.value, input.mode)).toBe('Digite um email válido')
  })

  it('remove apenas a apresentação do telefone quando o usuário passa a digitar email', () => {
    const input = updateProfileIdentifierInput('(12)3@exemplo.com', 'phone', '(12)3')

    expect(input).toEqual({ mode: 'email', value: '123@exemplo.com' })
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe('123@exemplo.com')
  })

  it('preserva pontuação de um email iniciado por números', () => {
    const input = updateProfileIdentifierInput('(12)3+tag', 'phone', '(12)3')

    expect(input).toEqual({ mode: 'email', value: '123+tag' })
  })

  it('preserva emails colados, inclusive caracteres internacionais', () => {
    const email = 'usuário+perfil@exemplo.com.br'
    const input = updateProfileIdentifierInput(email)

    expect(input).toEqual({ mode: 'email', value: email })
    expect(profileIdentifierRule(input.value, input.mode)).toBe(true)
    expect(normalizeProfileIdentifierForRequest(input.value, input.mode)).toBe(email)
  })

  it('volta automaticamente ao telefone se a entrada tornar-se compatível novamente', () => {
    const input = updateProfileIdentifierInput('11931234567', 'email')

    expect(input).toEqual({ mode: 'phone', value: '(11) 9 3123-4567' })
  })
})
