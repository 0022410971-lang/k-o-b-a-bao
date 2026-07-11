Thư mục assets/sounds/ này để trống có chủ đích.

Game hiện phát âm thanh bằng WebAudio (tự tạo tiếng bíp) nên KHÔNG cần file
âm thanh vẫn chạy đầy đủ 100%.

Để dùng âm thanh thật của bạn, bỏ file vào thư mục này với đúng TÊN GỐC
bên dưới - đuôi file có thể là .mp3, .m4a, .ogg hoặc .wav (game tự thử
từng loại, không cần sửa code):

  - select        -> khi 1 người chọn Búa/Bao/Kéo
  - reveal        -> khi cả 2 lộ bài
  - tie           -> khi hòa, chơi lại vòng
  - fire          -> khi viên đạn được bắn ra
  - hit           -> khi đạn trúng đối thủ
  - win           -> âm thanh chiến thắng dùng chung (dự phòng nếu thiếu
                     win_p1/win_p2 bên dưới)
  - lose          -> (dự phòng, hiện chưa dùng tới)
  - attack_p1     -> tiếng hô/tấn công riêng của Người 1
  - attack_p2     -> tiếng hô/tấn công riêng của Người 2
  - win_p1        -> âm thanh riêng khi Người 1 chiến thắng chung cuộc
  - win_p2        -> âm thanh riêng khi Người 2 chiến thắng chung cuộc

  Thứ tự ưu tiên khi có người thắng: win_p1/win_p2 (nếu có) -> win (nếu có)
  -> âm thanh mặc định tự tạo (khác cao độ giữa 2 người).

Ví dụ: đặt file "select.m4a" hoặc "select.mp3" đều được, miễn đúng tên gốc.
Thiếu file nào thì phần đó vẫn dùng âm thanh mặc định, không lỗi.
