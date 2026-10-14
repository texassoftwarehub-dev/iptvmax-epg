# iptvmax-epg

TV guide data for the IPTV Max app, rebuilt twice a day by GitHub Actions with
[iptv-org/epg](https://github.com/iptv-org/epg) and published on GitHub Pages:

- `https://texassoftwarehub-dev.github.io/iptvmax-epg/index.json`: every channel
  (iptv-org id, all known names, which file it is in).
- `https://texassoftwarehub-dev.github.io/iptvmax-epg/<cc>.xml.gz`: one gzipped
  XMLTV guide per country (`in`, `uk`, `us`, `pk`, `bd`…), two days ahead.

The app downloads `index.json`, matches the user's channels by `tvg-id` and then by
name, and fetches only the country files it needs. A user's own EPG link, set per
playlist, always takes precedence over this.

## Sources

`scripts/plan.mjs` lists them, in priority order. A channel is grabbed from the first
source that has it:

| Job | Site | Countries |
|---|---|---|
| tataplay | tataplay.com | India |
| dishtv | dishtv.in | India |
| airtel | airtelxstream.in | India |
| sky | sky.com | UK, plus the few India / Pakistan / Bangladesh channels Sky lists |
| tvpassport | tvpassport.com | US |

Only channels that iptv-org maps to a channel id are grabbed. Run the workflow by hand
from the Actions tab (`build` → Run workflow).
