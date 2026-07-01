# Přehled práce od Daniela Třetiny

Jednoduchá webová aplikace pro evidenci kalendářových poznámek, dokumentů, projektů, checklistů a hodnocení manažerky.

Aplikace je připravená pro GitHub Pages a ukládá data do Supabase databáze.

## Co aplikace umí

- Přihlášení pro dva typy účtů:
  - admin: plná správa
  - manažerka: pouze čtení + hodnocení projektů
- Kalendář s poznámkami podle dnů
- Nahrávání dokumentů k poznámkám
- Otevření dokumentu v novém okně
- Export všech poznámek do `.txt`
- Projekty rozdělené do kategorií:
  - Nápady
  - Rozpracované projekty
  - Hotové projekty
- Checklist u projektů
- Hodnocení manažerky 1–5 hvězdiček + komentář
- Český font kompatibilní s diakritikou
- Vlastní logo

## Důležitý první krok: vytvoření databáze

1. Otevři Supabase.
2. Jdi do **SQL Editor**.
3. Otevři v tomto repozitáři soubor:

```text
supabase/schema.sql
```

4. Zkopíruj celý obsah souboru.
5. Vlož ho do Supabase SQL Editoru.
6. Klikni na **Run**.

Tím se vytvoří tabulky, role, přihlašování, demo data a bezpečnostní funkce. Pokud přihlášení hlásí chybu `crypt`, spusť také `supabase/hotfix-login.sql`.

## GitHub Pages

Po nahrání souborů na GitHub zapni GitHub Pages:

1. Otevři repozitář `dano2709/Work`.
2. Jdi do **Settings**.
3. Vlevo klikni na **Pages**.
4. U **Build and deployment** nastav:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Klikni na **Save**.

Aplikace pak poběží přibližně na adrese:

```text
https://dano2709.github.io/Work/
```

Někdy trvá 1–3 minuty, než se stránka poprvé zobrazí.

## Bezpečnost

Frontend používá pouze Supabase publishable key. Secret key se do aplikace nikdy nevkládá.

Tabulky mají zapnuté Row Level Security. Přístup k datům probíhá přes databázové funkce:

- `login_user`
- `get_app_data`
- `add_calendar_note`
- `update_calendar_note`
- `delete_calendar_note`
- `add_calendar_document`
- `get_calendar_document`
- `create_project`
- `update_project`
- `move_project`
- `delete_project`
- `save_project_review`

Role se kontrolují v databázi, ne pouze ve frontendu.

## Poznámka k dokumentům

Dokumenty jsou v této verzi uložené přímo v databázi jako Base64. Je to jednoduché a funguje bez nastavování Supabase Storage. Pro velké soubory je lepší později přejít na Supabase Storage.
