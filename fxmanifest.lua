fx_version "cerulean"
game "gta5"
lua54 "yes"

author "wthejulio · CBz Network"
description "Retro comic hotwire minigames — screwdriver, wire panel, immobiliser bypass"
version "2.0.0"

ui_page "html/main.html"

files {
	"html/main.html",
	"html/style.css",
	"html/script.js",
	"html/vendor/jquery.min.js",
	"html/assets/*.png"
}

shared_script "config.lua"

client_script "client.lua"

server_script "server.lua"
