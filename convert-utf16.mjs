import fs from "fs";
for (const p of ["src/App.tsx","src/main.tsx","src/styles.css","src/components/HomeHero.tsx","src/components/StorefrontHeader.tsx","src/lib/storefrontCategories.ts","index.html"]) {
  try {
    const b = fs.readFileSync(p);
    let s;
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) s = b.toString("utf16le").replace(/^\uFEFF/, "");
    else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) s = b.swap16().toString("utf16le").replace(/^\uFEFF/, "");
    else s = b.toString("utf8").replace(/^\uFEFF/, "");
    fs.writeFileSync(p, s, "utf8");
    console.log("ok", p);
  } catch (e) { console.log("err", p, e.message); }
}
