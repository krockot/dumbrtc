package hello

import (
  "encoding/json"
  "fmt"
  "math/rand"
  "net/http"
  "time"

  "appengine"
  "appengine/datastore"
)

type channelEntry struct {
  PeerID string
}

type peerOffer struct {
  SourceID string
  Offer    []byte
}

type peerOfferInfo struct {
  SourceID string
  Offer string
}

type iceCandidate struct {
  Label      string
  ID         string
  Candidate  string
  SourceID   string
}

const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "0123456789./"

func init() {
  http.HandleFunc("/broker", brokerHandler)
}

func generatePeerId() string {
  r := rand.New(rand.NewSource(time.Now().UnixNano()))
  b := make([]byte, 64)
  for i := range b { b[i] = byte(letterBytes[r.Int() & 0x3f]) }
  return string(b)
}

func makeRootChannelKey(c appengine.Context, channelId string) *datastore.Key {
  return datastore.NewKey(c, "channelEntry", channelId, 0, nil)
}

func makeRootPeerKey(c appengine.Context, peerId string) *datastore.Key {
  return datastore.NewKey(c, "peer", peerId, 0, nil)
}

func brokerHandler(w http.ResponseWriter, r *http.Request) {
  c := appengine.NewContext(r)
  if r.Method != "POST" {
    http.Error(w, "Invalid request format", http.StatusBadRequest)
    return
  }

  decoder := json.NewDecoder(r.Body)
  var request struct {
    Operation     string
    ChannelID     string
    SourcePeerID  string
    TargetPeerID  string
    Candidate     *iceCandidate
    Offer         string
  }
  if err := decoder.Decode(&request); err != nil {
    http.Error(w, fmt.Sprintf("Invalid request format: %s", err),
        http.StatusBadRequest)
    return
  }
  switch request.Operation {
  case "join":
    joinChannel(c, w, request.ChannelID)
    return

  case "add ice candidate":
    addIceCandidate(c, w, request.SourcePeerID, request.TargetPeerID,
        request.Candidate);
    return

  case "add offer":
    addOffer(c, w, request.SourcePeerID, request.TargetPeerID, request.Offer)
    return

  case "get status":
    queryPeerStatus(c, w, request.SourcePeerID, request.ChannelID)
    return

  default:
    http.Error(w, fmt.Sprintf("Invalid operation: %s", request.Operation),
        http.StatusBadRequest)
    return
  }
}

func joinChannel(c appengine.Context, w http.ResponseWriter, channelId string) {
  if len(channelId) == 0 {
    http.Error(w, "Invalid channel ID", http.StatusBadRequest)
    return
  }

  peers, err := getPeersInChannel(c, channelId)
  if err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  parentKey := makeRootChannelKey(c, channelId)
  newEntryKey := datastore.NewIncompleteKey(c, "channelEntry", parentKey)

  newEntry := new(channelEntry)
  newEntry.PeerID = generatePeerId()
  if _, err := datastore.Put(c, newEntryKey, newEntry); err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  encoder := json.NewEncoder(w)
  encoder.Encode(struct {
    PeerID string
    Peers  []string
  }{ newEntry.PeerID, peers })
}

func addIceCandidate(c appengine.Context, w http.ResponseWriter,
    sourcePeerId, targetPeerId string, candidate *iceCandidate) {
  if candidate == nil || len(sourcePeerId) == 0 || len(targetPeerId) == 0 {
    http.Error(w, "Invalid 'add ice candidate' request", http.StatusBadRequest);
    return
  }

  parentKey := makeRootPeerKey(c, targetPeerId)
  newCandidateKey := datastore.NewIncompleteKey(c, "iceCandidate", parentKey)

  candidate.SourceID = sourcePeerId
  if _, err := datastore.Put(c, newCandidateKey, candidate); err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  encoder := json.NewEncoder(w)
  encoder.Encode(struct{}{})
}

func addOffer(c appengine.Context, w http.ResponseWriter,
    sourcePeerId, targetPeerId, offer string) {
  if len(sourcePeerId) == 0 || len(targetPeerId) == 0 || len(offer) == 0 {
    http.Error(w, "Invalid 'add offer' request", http.StatusBadRequest)
    return
  }

  parentKey := makeRootPeerKey(c, targetPeerId)
  newOfferKey := datastore.NewIncompleteKey(c, "peerOffer", parentKey)

  newOffer := new(peerOffer)
  newOffer.SourceID = sourcePeerId
  newOffer.Offer = []byte(offer)
  if _, err := datastore.Put(c, newOfferKey, newOffer); err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  encoder := json.NewEncoder(w)
  encoder.Encode(struct{}{})
}

func queryPeerStatus(
    c appengine.Context, w http.ResponseWriter, peerId, channelId string) {
  if len(peerId) == 0 || len(channelId) == 0 {
    http.Error(w, "Invalid 'get status' request", http.StatusBadRequest)
    return
  }

  peers, err := getPeersInChannel(c, channelId)
  if err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  candidates, err := getCandidatesForPeer(c, peerId)
  if err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  offers, err := getOffersForPeer(c, peerId)
  if err != nil {
    http.Error(w, err.Error(), http.StatusInternalServerError)
    return
  }

  encoder := json.NewEncoder(w)
  encoder.Encode(struct {
    Peers []string
    Candidates []iceCandidate
    Offers []peerOfferInfo
  }{ peers, candidates, offers })
}

func getPeersInChannel(
    c appengine.Context, channelId string) ([]string, error) {
  q := datastore.NewQuery("channelEntry").
          Ancestor(makeRootChannelKey(c, channelId))
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

func getCandidatesForPeer(
    c appengine.Context, peerId string) ([]iceCandidate, error) {
  q := datastore.NewQuery("iceCandidate").
          Ancestor(makeRootPeerKey(c, peerId))
  var candidates []iceCandidate
  if _, err := q.GetAll(c, &candidates); err != nil {
    return nil, err
  }
  return candidates, nil
}

func getOffersForPeer(
    c appengine.Context, peerId string) ([]peerOfferInfo, error) {
  q := datastore.NewQuery("peerOffer").
          Ancestor(makeRootPeerKey(c, peerId))
  var offers []peerOffer
  if _, err := q.GetAll(c, &offers); err != nil {
    return nil, err
  }

  offerInfo := make([]peerOfferInfo, len(offers))
  for i := range offers {
    offerInfo[i].SourceID = offers[i].SourceID
    offerInfo[i].Offer = string(offers[i].Offer)
  }
  return offerInfo, nil
}
