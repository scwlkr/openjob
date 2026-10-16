# Source provenance and integration

**Proposed, documentation only. Owner acceptance is pending.**

Source: Shane's Library **OpenJob-Review-and-Build-Package-v1.zip**, materialized
on 16 October 2026 through the Library tool and its current transfer helper.
The archive passed ZIP integrity/path checks before extraction.

- Library file: `libfile_140b93cbc3f48191a32eaff27b4b2057`
- Size: **578,003 bytes**
- SHA-256: `2f1c2d3d0de240720df6653e3ca0ac4252e7ddaa217cc6471822a323e209d0a8`
- Code snapshot used by the source: `9ba3929fbf0ccc3e24e2577410a355fa3798736e`
- Design snapshot used by the source: PR #87 `98f4da596c743c7bf577afb6b584ac38d408ab9f`

The ten source build-spec Markdown files are incorporated here with their stable
**33 OJ requirement IDs**, **20 proposed D defaults**, **22 R slices** and P0–P5
dependency structure. Repository-relative links, integration status and evidence
wording are adjusted where necessary. Independent integration review also clarifies
safe first-read rendering (R32), frozen outbound content (R41), export ownership
(R21), and explicit quote retention; source authority is not promoted.
[Market evidence](../market-evidence.md) preserves the supplied official-source
claims and their limitations. Hyphens in two public Microsoft source URLs are
percent-encoded because the local token hook mistakes its `task` URL slug for
a token; the destinations are unchanged. The [review companion](../review/OpenJob-Technical-Review-Memo-v2.md)
is a dated executive summary. Its historical source links remain snapshots.
The deck, PDFs and original ZIP remain in Library; repository Markdown carries
the editable proposed specification, avoiding duplicate binary review copies.

## Reconciliation with the existing design

| Existing design | Integrated detail and authority |
|---|---|
| Mission and platform blueprint | Mission remains mandate; blueprint remains architecture overview; PRODUCT/EXPERIENCE supply detailed requirements/screens |
| Companies and ADR 0020 | DOMAIN supplies entities/authorization; first Company release explicitly disables Company SSO and requires eligible independent personal proof |
| ADR 0019 | RUNTIME supplies hosted-first service, authenticated installed clients, normalized Firestore and encrypted credential repository defaults; all remain Proposed |
| ADR 0021 | CONTRACTS/RUNTIME supply durable jobs, metadata-only pilot cache, receipts, cleanup and later controlled offline scope |
| Earlier four outcome phases | ROADMAP is the single detailed dependency map P0–P5; the blueprint points to it rather than maintaining a second sequence |
| Earlier open question list | DECISIONS supplies three owner choices; provider accounts/keys/real effects and release are later execution gates |
| Narrow pilot | Required provider breadth, Calendar invitations/series, offline Company/Mail, native and authenticated npm outcomes remain in OJ-K5–K6/OJ-X5–X7 and R50–R55 |

This integration records no adopted decision, completed slice, new access or
working feature. Requirement coverage checks validate document consistency only.
The current OpenAPI remains the implemented contract, and Linear OpenJob remains
the sole execution queue. Owner review and development authorization must precede
feature implementation; merge, provisioning and release do not follow automatically.
