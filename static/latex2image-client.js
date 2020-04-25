let hasShownBefore = false;

$(document).ready(function () {
  function show(resultData) {
    function afterSlideUp() {
      let resultDataJSON;
      if ((resultDataJSON = JSON.parse(resultData)) && !resultDataJSON.error) {
        $("#resultImage").attr("src", resultDataJSON.imageURL);
        $("#downloadButton").attr("href", resultDataJSON.imageURL);
        $("#resultCard").show();
        $("#errorAlert").hide();
      } else {
        $("#errorAlert").text(
          resultDataJSON.error || "Invalid response received"
        );
        $("#errorAlert").show();
        $("#resultCard").hide();
      }
      $("#result").slideDown(330);

      // Scroll window to bottom
      $("html, body").animate(
        {
          scrollTop: $(document).height(),
        },
        1000
      );

      hasShownBefore = true;
    }

    $("#result").slideUp(hasShownBefore ? 330 : 0, afterSlideUp);
  }

  function render() {
    $("#preview").html("$$" + $("#latexInputTextArea").val() + "$$");
    MathJax.Hub.Queue(["Typeset", MathJax.Hub]);
  }

  $("#convertButton").click(function () {
    if (!$("#latexInputTextArea").val()) {
      show(
        JSON.stringify({
          error: "No LaTeX input provided",
        })
      );
      return;
    }

    $("#result").slideUp(hasShownBefore ? 330 : 0, function () {
      $("#resultImage").attr("src", "");
    });

    $("#convertButton").prop("disabled", true);
    $("#renderButton").prop("disabled", true);
    $("#convertButton").prop("value", "Converting...");
    $.ajax({
      url: "/convert",
      type: "POST",
      data: {
        latexInput: $("#latexInputTextArea").val(),
        outputFormat: $("#outputFormatSelect").val(),
        outputScale: $("#outputScaleSelect").val(),
      },
      success: function (data) {
        $("#convertButton").prop("disabled", false);
        $("#renderButton").prop("disabled", false);
        $("#convertButton").prop("value", "Convert");
        show(data);
      },
      error: function () {
        $("#convertButton").prop("disabled", false);
        $("#renderButton").prop("disabled", false);
        $("#convertButton").prop("value", "Convert");
        alert("Error communicating with server");
      },
    });
  });

  $("#renderButton").click(function () {
    render();
  });

  $("#latexInputTextArea").on("keyup", function () {
    if ($("#renderCheckbox").is(":checked")) render();
  });

  render();
});
