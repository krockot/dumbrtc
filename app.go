package hello

import (
  "fmt"
  "net/http"
)

func init() {
  http.HandleFunc("/broker", brokerHandler)
}

func brokerHandler(w http.ResponseWriter, r *http.Request) {
  fmt.Fprintln(w, "Hello I am the broker.")
}

