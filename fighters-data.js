(function defineSc1Fighters() {
  "use strict";

  // Gemensam datakälla för #athletes och fighter.html.
  // Kopiera ett helt fighter-objekt för att lägga till en profil.
  // slug måste vara unik och URL-säker; name är namnet som visas i kortet/heron.
  // Saknad text: "". Saknad statistik: null (0 betyder ett känt nollvärde).
  // Vid publicering: använd bekräftade uppgifter. Tomma värden visas som NA/platshållare.
  //
  // Hero: realName = Government name; nickname = valfri underrad;
  // instagram = fullständig https://www.instagram.com/... URL.
  // Info: country = Representing; height = Height; weight = Last fight weight (cm/kg);
  // fightingBackground = confirmed training background (e.g. MMA or boxing);
  // affiliation = team/klubb; record = resultat som text.
  // bio = How they fight; knownFor = Known for.
  // Win by: antal vinster per metod, heltal >= 0. Ingen statistik räknas ut från record.
  // Fan reaction: love/hate är bekräftade värden 0–10, inte fungerande omröstningar.
  // Media: portrait = bildsökväg; photos = [{ src: "...", alt: "...", fullSrc: "..." }];
  // fullSrc är valfri högupplöst bild för popupen; om den saknas används src.
  // videos = [{ title: "...", youtubeId: "..." }] (bara video-ID, inte hela URL:en).
  // Tomt photos använder portrait om det finns, annars en tom platshållare.
  // age/weightClass sparas för kompatibilitet; age visas inte i nuvarande profil.
  window.SC1_FIGHTERS = [
    {
      slug: "sc1simon",
      name: "SC1SIMON",
      realName: "Simon Ljungberg",
      nickname: "",
      record: "2–0",
      instagram: "https://www.instagram.com/sc1simon/",

      country: "Sweden",
      height: "182 cm",
      weight: "81 kg",
      fightingBackground: "Street/MMA",
      affiliation: "Cleanup Crew",

      bio: "A pressure based fighter who prefers to close the distance, take his opponent down, and dominate through wrestling and “ground and pound”. Focuses on maintaining control, using his weight and positioning to apply constant pressure and finish opponents on the ground.",
      knownFor: "Creating SC1 and also participating in it.",
      winBy: {
        koTko: 2,
        submission: 0,
        opponentForfeit: 0,
      },
      fanReaction: {
        love: 7,
        hate: 5,
      },

      age: "",
      weightClass: "",
      // Lägg fler foton i assets/fighters/sc1simon/ och lägg till dem i photos här.
      portrait: "assets/fighters/sc1simon/simonpf.jpeg",
      photos: [
        { src: "assets/fighters/sc1simon/simonpf.jpeg", alt: "SC1SIMON official portrait" },
        { src: "assets/fighters/sc1simon/1CC79B46-5754-45EB-BA42-3209C0F5EDFB.jpg", alt: "SC1SIMON photo 2" },
        { src: "assets/fighters/sc1simon/DSCF0124.JPG", alt: "SC1SIMON photo 3" },
        { src: "assets/fighters/sc1simon/DSCF0251.JPG", alt: "SC1SIMON photo 4" },
        { src: "assets/fighters/sc1simon/DSCF6660.JPG", alt: "SC1SIMON photo 5" },
        { src: "assets/fighters/sc1simon/DSCF6738.JPG", alt: "SC1SIMON photo 6" },
        { src: "assets/fighters/sc1simon/DSCF6948.JPG", alt: "SC1SIMON photo 7" },
        { src: "assets/fighters/sc1simon/Untitled design.png", alt: "SC1SIMON photo 8" },
      ],
      videos: [
        {
          title: "DETOUR FACE-OFF",
          youtubeId: "fT3uTLo4v2I",
        },
        {
          title: "BADLANDS FACE-OFF",
          youtubeId: "naG-tE_PeZs",
        },
        {
          title: "BREAKOUT FACE-OFF",
          youtubeId: "iLQqvBBUJ8g",
        },
        {
          title: "SC1SIMON VS BAASKA",
          youtubeId: "QeH_ZdZzzMQ",
        },
        {
          title: "SC1SIMON VS “NO NAME”",
          youtubeId: "THVvHvrhd3g",
        },
      ],
    },
  ];

  window.dispatchEvent(new CustomEvent("sc1:fighters-ready"));
})();
