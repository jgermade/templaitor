# Data contract of a template — 2026-11-23

Goal: every template declares the data it expects (names, types, required, description), so the backend has
a contract to fulfil, the editor shows it as types in the Design view, and the send API refuses data that
does not match.

## Decisions (with the user)

| Topic | Decision | Why |
|---|---|---|
| Where | Frontmatter of the template's `.mjml`, key `data:` (next to `layout`, `format`, `attachments`); the `.yml` keeps only translations | One place for what the template is; the `.yml` stays content per language |
| Syntax | `name: type` or `name: { type, required, description, of }`; types `string · number · boolean · date · url · email · list · object`; `list` has `of` (a type or fields), `object` its fields | Short to write by hand; same spirit as component `params` |
| Demo data | Stays as example values (`.json5`), validated against the contract (warnings) | The preview keeps working; mismatches are visible |
| Checks | Warnings: variable used but not declared, declared but not used, demo data not matching | The contract stays true to the template |
| Send API | `/v1/send` and `/v1/render` reject data that does not match with **422** and the list of errors | An email never goes out with gaps (user's choice) |
| Export | `<name>.schema.json` (JSON Schema 2020-12) when compiling; `engine.schema(id)`; `GET /v1/schema?template=` | The backend can validate or generate types from it |
| Existing templates | "Generate from demo data" builds the contract from the demo data and the variables the template uses | No manual start |

```mermaid
gantt
    title templaitor — data contract
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Shared
    contract.js: normalize, validate, infer, JSON Schema, used variables   :c1, 2026-11-23, 1d

    section Engine and API
    Warnings (undeclared / unused / demo data), schema.json on compile    :e1, after c1, 1d
    Validation in renderMessage (422), engine.schema, GET /v1/schema      :e2, after c1, 1d

    section Editor
    Data panel in Design: types, required, description, add/remove       :d1, after e1, 1d
    Generate from demo data; suggestions from the contract               :d2, after d1, 1d

    section Templates
    Contracts for the demo and the repository's templates                 :done, t1, after e2, 1d
```
