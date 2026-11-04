lastPicked () {
  /shared/pred/lastPicked
}

pickGdKey () {
  pick as:meta.gdKey 1
}

pickGdKeys () {
  pick as:meta.gdKey $@
}

pickGrKey () {
  pick as:meta.grKey 1
}

playerKey () {
  w player.key
}

playerPath () {
  echo /shared/pred/player
}

setPlayer () {
  w player.setKey $1
}
