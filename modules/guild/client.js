// @ts-check
// Guild module, client entry. The panel lists members with their roles,
// and officers and the owner get invite, promote, demote, kick and the
// privacy toggle. guild:invite fires when someone invites this player.

const ui = engine.ui;
const panel = ui.panel({ title: "Guild" });
ui.actionButton("Guild", () => panel.toggle(), "g");

let state = null; // null = not in guild, guild record = in guild
let myName = null; // set on first guild:update

const ROLE_ICON = { owner: "♛", moderator: "★", member: "•" };

function myRole() {
  if (!state || !myName) return "member";
  const me = state.members.find((m) => m.name === myName);
  return me ? me.role : "member";
}

function canManage() {
  const r = myRole();
  return r === "owner" || r === "moderator";
}

function renderNoGuild() {
  const nameIn = ui.input("Guild name");
  const privSel = document.createElement("select");
  privSel.style.cssText =
    "width:100%;padding:6px 8px;border:1px solid #444;border-radius:4px;" +
    "font:13px sans-serif;background:#1a1a1a;color:#eee;box-sizing:border-box;";
  ["public", "private"].forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    privSel.appendChild(o);
  });
  const createBtn = ui.button("Create Guild", () => {
    const name = nameIn.value.trim();
    if (name)
      engine.sendServerEvent("guild:create", { name, privacy: privSel.value });
  });
  const joinBtn = ui.button("Join Public", () => {
    const name = nameIn.value.trim();
    if (name) engine.sendServerEvent("guild:join", { name });
  });
  panel.setTitle("Guild");
  panel.setBody(nameIn, privSel, ui.row(createBtn, joinBtn));
}

function renderGuild(g) {
  const badge = document.createElement("span");
  badge.textContent = g.privacy === "private" ? "🔒 Private" : "🌐 Public";
  badge.style.cssText = "font-size:11px;color:#aaa;";

  const memberList = document.createElement("div");
  memberList.style.cssText = "margin:6px 0;max-height:180px;overflow-y:auto;";

  for (const m of g.members) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:2px 0;border-bottom:1px solid #2a2a2a;font-size:13px;";
    const nameEl = document.createElement("span");
    nameEl.textContent = `${ROLE_ICON[m.role] || "•"} ${m.name}`;
    if (m.name === myName) nameEl.style.fontWeight = "bold";
    row.appendChild(nameEl);

    if (myRole() === "owner" && m.name !== myName) {
      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:3px;";
      if (m.role === "member") {
        const promBtn = ui.button("↑", () =>
          engine.sendServerEvent("guild:promote", { target: m.name }),
        );
        promBtn.style.cssText += "padding:2px 5px;font-size:11px;";
        btnRow.appendChild(promBtn);
      } else if (m.role === "moderator") {
        const demBtn = ui.button("↓", () =>
          engine.sendServerEvent("guild:demote", { target: m.name }),
        );
        demBtn.style.cssText += "padding:2px 5px;font-size:11px;";
        btnRow.appendChild(demBtn);
      }
      const kickBtn = ui.button("✕", () => {
        engine.sendServerEvent("guild:kick", { target: m.name });
      });
      kickBtn.style.cssText +=
        "padding:2px 5px;font-size:11px;background:#c0392b;";
      kickBtn.onmouseenter = () => (kickBtn.style.background = "#e74c3c");
      kickBtn.onmouseleave = () => (kickBtn.style.background = "#c0392b");
      btnRow.appendChild(kickBtn);
      row.appendChild(btnRow);
    }

    memberList.appendChild(row);
  }

  const controls = [];

  if (canManage()) {
    const invIn = ui.input("Invite player name");
    const invBtn = ui.button("Invite", () => {
      const t = invIn.value.trim();
      if (t) {
        engine.sendServerEvent("guild:invite", { target: t });
        invIn.value = "";
      }
    });
    controls.push(ui.row(invIn, invBtn));
  }

  if (myRole() === "owner") {
    const privBtn = ui.button(
      g.privacy === "private" ? "Make Public" : "Make Private",
      () =>
        engine.sendServerEvent("guild:privacy", {
          privacy: g.privacy === "private" ? "public" : "private",
        }),
    );
    privBtn.style.cssText += "width:100%;";
    controls.push(privBtn);
  }

  const leaveBtn = ui.button("Leave Guild", () =>
    engine.sendServerEvent("guild:leave"),
  );
  leaveBtn.style.cssText += "background:#555;width:100%;";
  leaveBtn.onmouseenter = () => (leaveBtn.style.background = "#777");
  leaveBtn.onmouseleave = () => (leaveBtn.style.background = "#555");
  controls.push(leaveBtn);

  panel.setTitle(`${g.name} (${g.members.length})`);
  panel.setBody(badge, memberList, ...controls);
}

function render() {
  if (!state) renderNoGuild();
  else renderGuild(state);
}

engine.onServerEvent("guild:update", (g) => {
  if (g && g.self) myName = g.self;
  state = g;
  render();
});

engine.onServerEvent("guild:invite", ({ guildName, from }) => {
  const notif = ui.panel({ title: `Guild invite: ${guildName}` });
  const msg = document.createElement("div");
  msg.textContent = `${from} invited you to "${guildName}"`;
  msg.style.cssText = "font-size:13px;margin-bottom:6px;";
  const acceptBtn = ui.button("Accept", () => {
    engine.sendServerEvent("guild:accept", { guildName });
    notif.remove();
  });
  const declineBtn = ui.button("Decline", () => notif.remove());
  declineBtn.style.background = "#555";
  declineBtn.onmouseenter = () => (declineBtn.style.background = "#777");
  declineBtn.onmouseleave = () => (declineBtn.style.background = "#555");
  notif.setBody(msg, ui.row(acceptBtn, declineBtn));
  notif.show();
  setTimeout(() => notif.remove(), 60_000);
});

engine.onServerEvent("guild:kicked", ({ from }) => {
  engine.chat(`You were kicked from guild "${from}".`);
  const msg = document.createElement("div");
  msg.textContent = `You were kicked from "${from}"`;
  msg.style.cssText =
    "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);" +
    "background:#c0392b;color:#fff;padding:8px 16px;border-radius:6px;" +
    "font:bold 13px sans-serif;z-index:9999;pointer-events:none;";
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 4000);
});

engine.registerPlayerAction("Invite to Guild", (name) => {
  engine.sendServerEvent("guild:invite", { target: name });
});

engine.sendServerEvent("guild:request");
renderNoGuild(); // populate panel before first update
