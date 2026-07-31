# Artifact specification — Relatório de Impacto Notify Flow

## Reference authority

- Source: `C:\Users\samuel\Downloads\Template Relatorio de Impacto - TJGO PRTI - Samuel Victor Oliveira Lima.docx`
- SHA-256: `70103C81C778FE548FDED375E82327C8E7A82108BA86387A551517B18C53F306`
- The retained DOCX is the visual authority for the final artifact.
- Exact rendered page count is unresolved because neither Microsoft Word nor LibreOffice is installed in this environment. The source contains 12 explicit page breaks and two Word sections.

## Page geometry and recurring regions

- Page size: US Letter, portrait.
- Margins: 1.25 in left/right; 1.0 in top/bottom.
- Header/footer distance: 0.5 in.
- Two sections. Section 1 uses a different first page; section 2 does not.
- Preserve the UFG identity/logo, institutional cover hierarchy, academic header, footer and PAGE field.
- Replace the placeholder title in the recurring header with the report title.

## Typography and hierarchy

- Visible reference typography takes precedence over latent style defaults.
- Body: Times New Roman, 12 pt, justified, 1.5 line spacing, 1 cm first-line indent.
- Level 1 headings: Times New Roman, 14 pt, bold, black, uppercase where appropriate.
- Level 2 headings: Times New Roman, 12 pt, bold, black.
- Level 3 headings: Times New Roman, 12 pt, bold/italic as needed.
- Captions and source notes: Times New Roman, 10 pt.
- Keep headings with the paragraph that follows and avoid orphaned captions.

## Required front matter

- Institutional cover with one author: Samuel Victor Oliveira Lima.
- Title page with advisor: Leonardo Oliveira.
- Executive summary.
- Lists of figures, tables and abbreviations.
- Word-generated table of contents, marked for update on open.

## Required report structure

1. Introdução.
2. Fundamentação teórica.
3. Metodologia.
4. Desenvolvimento, resultados e discussão.
5. Considerações finais.
6. Referências.
7. Appendices for user stories, setup and test evidence.

## Preserve / replace / remove

### Preserve

- UFG logo and institutional placement.
- Cover/title-page layout.
- Page geometry and section logic.
- Header/footer structure and page-number field.
- Academic visual hierarchy.

### Replace

- Student placeholders with Samuel Victor Oliveira Lima.
- Title placeholders with the Notify Flow report title.
- Advisor placeholder with Leonardo Oliveira.
- Every instructional paragraph with project-specific prose.
- Sample tables with test, architecture, deployment and risk tables.

### Remove

- Second/third author placeholders.
- Sample pie chart.
- Template guidance comments.
- Empty placeholder content controls and all instructional boilerplate.
- Empty annex sections.

## Visual inventory

- UFG logo retained from the source.
- New high-resolution diagrams:
  1. End-to-end architecture.
  2. Consent and identity-linking journey.
  3. Queue, retry, receipt and audit lifecycle.
  4. Meta/WhatsApp production onboarding.
- Product illustration: `frontend/public/meuperfil.png`.
- Tables must fit the printable width; no text may be clipped.

## Evidence and fidelity gates

- No template placeholder text or comments.
- No secret, token, password or live credential.
- Tests must state the exact observed result and date.
- Manual validation must not be described as a formal user study.
- Current provider rules/costs must be framed as time-sensitive and linked to official sources.
- The final DOCX must pass structural, accessibility, field, image and placeholder audits.
- Google Docs title sanitization must be applied.
- Because an office renderer is unavailable, final visual validation will use structural/layout heuristics and package inspection; this limitation must be disclosed at handoff.
