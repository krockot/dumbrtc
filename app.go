package hello

import (
  "encoding/json"
  "math/rand"
  "net/http"
  "time"

  "appengine"
  "appengine/datastore"
)

type channelEntry struct {
  PeerID string
}

const letterBytes = (
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./")

func init() {
  http.HandleFunc("/broker", brokerHandler)
}

func generatePeerId() string {
  r := rand.New(rand.NewSource(time.Now().UnixNano()))
  b := make([]byte, 64)
  for i := range b { b[i] = byte(letterBytes[r.Int() & 0x3f]) }
  return string(b)
}

func getRootChannelKey(c appengine.Context, channelId string) *datastore.Key {
  return datastore.NewKey(c, "channelEntry", channelId, 0, nil)
}

func getRootPeerKey(c appengine.Context, peerId string)

func brokerHandler(w http.ResponseWriter, r *http.Request) {
  c := appengine.NewContext(r)
  if r.Method != "POST" {
    http.Error(w, "Invalid request format", http.StatusBadRequest)
    return
  }

  decoder := json.NewDecoder(r.Body)
  var request struct {
    Operation string
    PeerID    string
    ChannelID string
    Offer     string
  }
  if err := decoder.Decode(&request); err != nil {
    http.Error(w, "Invalid request format", http.StatusBadRequest)
    return
  }
  switch request.Operation {
  case "join":
    joinChannel(c, w, request.ChannelID)
    return

  default:
    http.Error(w, "Invalid operation", http.StatusBadRequest)
    return
  }
}

func joinChannel(c appengine.Context, w http.ResponseWriter, channelId string) {
  if len(channelId) == 0 {
    http.Error(w, "Invalid channel ID", http.StatusBadRequest)
    return
  }

  parentKey := getRootChannelKey(c, channelId)
  channelEntryKey := datastore.NewIncompleteKey(c, "channelEntry", parentKey)

  peers, err := getPeersInChannel(c, channelId)
  if err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  entry := new(channelEntry)
  entry.PeerID = generatePeerId()
  if _, err := datastore.Put(c, channelEntryKey, entry); err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  encoder := json.NewEncoder(w)
  encoder.Encode(struct {
    PeerID string
    Peers  []string
  }{ entry.PeerID, peers })
}

func getPeersInChannel(
    c appengine.Context, channelId string) ([]string, error) {
  q := datastore.NewQuery("channelEntry").
          Ancestor(getRootChannelKey(c, channelId))
  var channelEntries []channelEntry
  if _, err := q.GetAll(c, &channelEntries); err != nil {
    return nil, err
  }
  peerIds := make([]string, len(channelEntries))
  for i := range channelEntries {
    peerIds[i] = channelEntries[i].PeerID
  }
  return peerIds, nil
}
